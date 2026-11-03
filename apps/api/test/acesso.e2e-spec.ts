import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Isolamento A x B por endpoint (AGENTS.md §3.13, Prompt 1.4) e fluxos da matriz, convite, step-up,
// exclusão com dupla aprovação e notificações.
describe('acesso', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Conta { email: string; token: string; uri: string }

  // Login + cadastro do autenticador; o fator é "envelhecido" (step-up exige ≥ 24 h).
  async function entrar(email: string): Promise<Conta> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri(uri) }).expect(200);
    await admin.query(`update core.fatores_mfa set verificado_em = now() - interval '2 days'
                        where usuario_id = (select id from core.usuarios where email = $1)`, [email]);
    return { email, uri, token: (conf.body as { token: string }).token };
  }

  // Step-up com TOTP novo; libera o passo usado (simula a passagem do tempo entre verificações).
  async function stepUp(c: Conta, escopo: string): Promise<string> {
    await admin.query(`update core.fatores_mfa set ultimo_passo = 0
                        where usuario_id = (select id from core.usuarios where email = $1)`, [c.email]);
    const r = await http().post('/auth/mfa/step-up').set(bearer(c.token)).send({ codigo: totpDaUri(c.uri), escopo }).expect(200);
    const b = r.body as { stepUp: string; token: string };
    c.token = b.token;
    return b.stepUp;
  }

  let empA: string;
  let empB: string;
  let a: Conta;
  let b: Conta;
  let vinculoB: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Empresa e2e A');
    empB = await criarEmpresa('Empresa e2e B');
    const emailA = await criarUsuario('acesso-a');
    const emailB = await criarUsuario('acesso-b');
    await vincular(emailA, empA);
    vinculoB = await vincular(emailB, empB);
    a = await entrar(emailA);
    b = await entrar(emailB);
  });
  afterAll(async () => {
    await app.close();
  });

  it('A x B: rotas da empresa B respondem 404 para A, sem revelar se existe', async () => {
    const t = bearer(a.token);
    await http().get(`/empresas/${empB}`).set(t).expect(404);
    await http().patch(`/empresas/${empB}`).set(t).send({ nomeFantasia: 'Hackeada' }).expect(404);
    await http().get(`/empresas/${empB}/usuarios`).set(t).expect(404);
    await http().get(`/empresas/${empB}/convites`).set(t).expect(404);
    await http().post(`/empresas/${empB}/convites`).set(t)
      .send({ email: 'x@teste.local', papel: 'OPERADOR', permissoes: [], stepUp: crypto.randomUUID() }).expect(404);
    await http().get(`/empresas/${empB}/auditoria`).set(t).expect(404);
    await http().get(`/empresas/${crypto.randomUUID()}`).set(t).expect(404);
    await http().get('/empresas/nao-e-uuid').set(t).expect(404);
    const lista = await http().get('/empresas').set(t).expect(200);
    expect((lista.body as { id: string }[]).map((e) => e.id)).toEqual([empA]);
  });

  it('A x B: funções do banco recusam vínculo e convite de B mesmo com step-up de A', async () => {
    const su = await stepUp(a, 'alterar_permissoes');
    await http().put(`/vinculos/${vinculoB}`).set(bearer(a.token))
      .send({ papel: 'CLIENTE', ativo: false, permissoes: [], stepUp: su }).expect(403);
    const conviteB = await admin.query<{ id: string }>(
      `insert into core.convites (empresa_id, email, papel, criado_por)
       select $1, 'alvo@teste.local', 'OPERADOR', id from core.usuarios where email = $2 returning id`, [empB, b.email]);
    await http().delete(`/convites/${conviteB.rows[0]?.id ?? ''}`).set(bearer(a.token)).expect(403);
    const n = await admin.query<{ id: string }>(
      `insert into core.notificacoes (usuario_id, tipo, titulo) select id, 'sistema', 'só de B' from core.usuarios
        where email = $1 returning id`, [b.email]);
    await http().post(`/notificacoes/${n.rows[0]?.id ?? ''}/lida`).set(bearer(a.token)).expect(204);
    const lida = await admin.query<{ lida_em: Date | null }>('select lida_em from core.notificacoes where id = $1', [n.rows[0]?.id]);
    expect(lida.rows[0]?.lida_em).toBeNull();
    const notifsA = await http().get('/notificacoes').set(bearer(a.token)).expect(200);
    expect((notifsA.body as unknown[]).length).toBe(0);
  });

  it('matriz: salvar vínculo exige step-up do escopo certo', async () => {
    const emailOp = await criarUsuario('acesso-op');
    const vinculoOp = await vincular(emailOp, empA, 'OPERADOR', ['empresas:visualizar']);
    await http().put(`/vinculos/${vinculoOp}`).set(bearer(a.token))
      .send({ papel: 'OPERADOR', ativo: true, permissoes: ['empresas:visualizar', 'empresas:editar'], stepUp: crypto.randomUUID() })
      .expect(403);
    const errado = await stepUp(a, 'exclusao_definitiva');
    await http().put(`/vinculos/${vinculoOp}`).set(bearer(a.token))
      .send({ papel: 'OPERADOR', ativo: true, permissoes: ['empresas:visualizar'], stepUp: errado }).expect(403);
    const su = await stepUp(a, 'alterar_permissoes');
    await http().put(`/vinculos/${vinculoOp}`).set(bearer(a.token))
      .send({ papel: 'OPERADOR', ativo: true, permissoes: ['empresas:visualizar', 'empresas:editar'], stepUp: su }).expect(200);
    const usuarios = await http().get(`/empresas/${empA}/usuarios`).set(bearer(a.token)).expect(200);
    const op = (usuarios.body as { vinculoId: string; permissoes: string[] }[]).find((u) => u.vinculoId === vinculoOp);
    expect(op?.permissoes).toEqual(['empresas:editar', 'empresas:visualizar']);
  });

  it('convite: admin convida com step-up, o convidado vê e aceita, e passa a ver a empresa', async () => {
    const emailNovo = await criarUsuario('acesso-convidado');
    const su = await stepUp(a, 'alterar_permissoes');
    await http().post(`/empresas/${empA}/convites`).set(bearer(a.token))
      .send({ email: emailNovo, papel: 'CLIENTE', permissoes: ['empresas:visualizar'], stepUp: su }).expect(201);
    const login = await http().post('/auth/login').send({ email: emailNovo, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t = bearer((login.body as { token: string }).token);
    const meus = await http().get('/me/convites').set(t).expect(200);
    const convite = (meus.body as { id: string; empresa: string }[])[0];
    expect(convite?.empresa).toBe('Empresa e2e A');
    await http().post(`/me/convites/${convite?.id ?? ''}/aceitar`).set(t).expect(201);
    const me = await http().get('/me').set(t).expect(200);
    expect((me.body as { vinculos: { empresaId: string }[] }).vinculos.map((v) => v.empresaId)).toEqual([empA]);
    await http().get(`/empresas/${empA}`).set(t).expect(200);
    await http().patch(`/empresas/${empA}`).set(t).send({ nomeFantasia: 'X' }).expect(404);
  });

  it('exclusão definitiva: só SUPERADMIN, com dupla aprovação de outro SUPERADMIN', async () => {
    const alvo = await criarEmpresa('Empresa e2e a excluir');
    const s1 = await entrar(await criarUsuario('acesso-super1'));
    const s2 = await entrar(await criarUsuario('acesso-super2'));
    await admin.query('update core.usuarios set superadmin = true where email = any($1)', [[s1.email, s2.email]]);
    const naoSuper = await stepUp(a, 'exclusao_definitiva');
    await http().post('/exclusoes').set(bearer(a.token))
      .send({ tabela: 'core.empresas', id: alvo, motivo: 'Encerramento de contrato', stepUp: naoSuper }).expect(403);
    const p1 = await stepUp(s1, 'exclusao_definitiva');
    const pedido = await http().post('/exclusoes').set(bearer(s1.token))
      .send({ tabela: 'core.empresas', id: alvo, motivo: 'Encerramento de contrato', stepUp: p1 }).expect(201);
    const id = (pedido.body as { id: string }).id;
    const p1b = await stepUp(s1, 'exclusao_definitiva');
    await http().post(`/exclusoes/${id}/decidir`).set(bearer(s1.token)).send({ aprovar: true, stepUp: p1b }).expect(403);
    const p2 = await stepUp(s2, 'exclusao_definitiva');
    await http().post(`/exclusoes/${id}/decidir`).set(bearer(s2.token)).send({ aprovar: true, stepUp: p2 }).expect(204);
    const resto = await admin.query('select 1 from core.empresas where id = $1', [alvo]);
    expect(resto.rowCount).toBe(0);
  });

  it('notificações: o destinatário vê e marca como lida', async () => {
    const n = await admin.query<{ id: string }>(
      `insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, link)
       select id, $2, 'agenda', 'prazo', 'Prazo em 2 dias', '/agenda' from core.usuarios where email = $1 returning id`,
      [a.email, empA]);
    const lista = await http().get('/notificacoes').set(bearer(a.token)).expect(200);
    expect((lista.body as { id: string }[]).map((x) => x.id)).toContain(n.rows[0]?.id);
    await http().post(`/notificacoes/${n.rows[0]?.id ?? ''}/lida`).set(bearer(a.token)).expect(204);
    const lida = await admin.query<{ lida_em: Date | null }>('select lida_em from core.notificacoes where id = $1', [n.rows[0]?.id]);
    expect(lida.rows[0]?.lida_em).not.toBeNull();
  });

  it('mesma empresa: OPERADOR só com empresas:visualizar não vê usuários, convites nem auditoria', async () => {
    const email = await criarUsuario('acesso-op-leitura');
    await vincular(email, empA, 'OPERADOR', ['empresas:visualizar']);
    const op = await entrar(email);
    const t = bearer(op.token);
    await http().get(`/empresas/${empA}`).set(t).expect(200);
    await http().patch(`/empresas/${empA}`).set(t).send({ nomeFantasia: 'X' }).expect(404);
    await http().get(`/empresas/${empA}/usuarios`).set(t).expect(404);
    await http().get(`/empresas/${empA}/convites`).set(t).expect(404);
    await http().get(`/empresas/${empA}/auditoria`).set(t).expect(404);
    // Revogação vale na requisição seguinte.
    await admin.query(`delete from core.permissoes where empresa_id = $1 and modulo = 'empresas'
                        and vinculo_id in (select v.id from core.vinculos v join core.usuarios u on u.id = v.usuario_id
                                            where u.email = $2)`, [empA, email]);
    await http().get(`/empresas/${empA}`).set(t).expect(404);
    // O próprio vínculo continua visível em /me, mesmo sem empresas:visualizar.
    const me = await http().get('/me').set(t).expect(200);
    expect((me.body as { vinculos: { empresaId: string }[] }).vinculos.map((v) => v.empresaId)).toEqual([empA]);
  });

  it('erro de constraint não expõe nome de tabela ou índice', async () => {
    const sup = await entrar(await criarUsuario('acesso-super-cnpj'));
    await admin.query('update core.usuarios set superadmin = true where email = $1', [sup.email]);
    const r = await http().post('/empresas').set(bearer(sup.token))
      .send({ razaoSocial: 'Empresa inválida', cnpj: '11222333000182' }).expect(400);
    expect(r.body).toMatchObject({ message: 'Dados inválidos.' });
    expect(JSON.stringify(r.body)).not.toMatch(/constraint|core\.|empresas_|_check/);
  });

  it('cookie sem token CSRF não salva vínculo', async () => {
    const login = await http().post('/auth/login').send({ email: a.email, senha: SENHA, plataforma: 'web' }).expect(200);
    const ck = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await http().put(`/vinculos/${crypto.randomUUID()}`).set('Cookie', ck)
      .send({ papel: 'OPERADOR', ativo: true, permissoes: [], stepUp: crypto.randomUUID() }).expect(403);
  });
});
