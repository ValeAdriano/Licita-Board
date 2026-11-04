import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

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

  it('catálogo de módulos: exige sessão e lista os módulos em ordem', async () => {
    await http().get('/modulos').expect(401);
    const r = await http().get('/modulos').set(bearer(a.token)).expect(200);
    const slugs = (r.body as { slug: string }[]).map((m) => m.slug);
    expect(slugs.slice(0, 3)).toEqual(['empresas', 'usuarios', 'permissoes']);
    expect(slugs).toContain('agenda');
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
    const convite = (meus.body as { id: string; empresa: string; cnpj: string; convidado_por: string | null }[])[0];
    expect(convite?.empresa).toBe('Empresa e2e A');
    // T3.1c: quem recebe vê o CNPJ e quem convidou antes de aceitar.
    expect(convite?.cnpj).toMatch(/^[0-9A-Z]{12}[0-9]{2}$/);
    expect(convite?.convidado_por).toBeTruthy();
    // O conjunto de campos é fixo: coluna nova na função não vira resposta sem revisão.
    expect(Object.keys(convite ?? {}).sort()).toEqual(
      ['cnpj', 'convidado_em', 'convidado_por', 'empresa', 'expira_em', 'id', 'papel', 'permissoes']);
    await http().post(`/me/convites/${convite?.id ?? ''}/aceitar`).set(t).expect(201);
    const me = await http().get('/me').set(t).expect(200);
    expect((me.body as { vinculos: { empresaId: string }[] }).vinculos.map((v) => v.empresaId)).toEqual([empA]);
    expect(typeof (me.body as { usuario: { temMfa: unknown } }).usuario.temMfa).toBe('boolean');
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
    expect(typeof (me.body as { usuario: { temMfa: unknown } }).usuario.temMfa).toBe('boolean');
  });

  it('erro de constraint não expõe nome de tabela ou índice', async () => {
    const sup = await entrar(await criarUsuario('acesso-super-cnpj'));
    await admin.query('update core.usuarios set superadmin = true where email = $1', [sup.email]);
    const r = await http().post('/empresas').set(bearer(sup.token))
      .send({ razaoSocial: 'Empresa inválida', cnpj: '11222333000182' }).expect(400);
    expect(r.body).toMatchObject({ message: 'Dados inválidos.' });
    expect(JSON.stringify(r.body)).not.toMatch(/constraint|core\.|empresas_|_check/);
  });

  // CA-2 e CA-3: o vínculo vale por empresa (OPERADOR com permissões diferentes em A e em B) e o
  // CLIENTE, como atacante, não passa da própria empresa.
  it('OPERADOR com vínculos em duas empresas só faz em cada uma o que lhe foi dado', async () => {
    const op = await entrar(await criarUsuario('acesso-op2'));
    await vincular(op.email, empA, 'OPERADOR', ['empresas:visualizar']);
    await vincular(op.email, empB, 'OPERADOR', ['empresas:visualizar', 'empresas:editar']);
    const t = bearer(op.token);
    const lista = await http().get('/empresas').set(t).expect(200);
    expect((lista.body as { id: string }[]).map((e) => e.id).sort()).toEqual([empA, empB].sort());

    const status = (await http().patch(`/empresas/${empA}`).set(t).send({ nomeFantasia: 'Sem permissão' })).status;
    expect([403, 404]).toContain(status);
    await http().get(`/empresas/${empA}/usuarios`).set(t).expect(404); // só empresas:visualizar em A
    await http().patch(`/empresas/${empB}`).set(t).send({ nomeFantasia: 'Fantasia de B' }).expect(200);
    const nomes = await admin.query<{ id: string; nome_fantasia: string | null }>(
      'select id, nome_fantasia from core.empresas where id = any($1)', [[empA, empB]]);
    const porId = Object.fromEntries(nomes.rows.map((r) => [r.id, r.nome_fantasia]));
    expect(porId[empA]).not.toBe('Sem permissão');
    expect(porId[empB]).toBe('Fantasia de B');
  });

  it('CLIENTE como atacante: não vê a empresa B, não cria empresa nem mexe em exclusões', async () => {
    const email = await criarUsuario('acesso-cliente');
    await vincular(email, empA, 'CLIENTE', ['empresas:visualizar']);
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t = bearer((login.body as { token: string }).token);

    await http().get(`/empresas/${empA}`).set(t).expect(200);
    await http().get(`/empresas/${empB}`).set(t).expect(404);
    await http().patch(`/empresas/${empB}`).set(t).send({ nomeFantasia: 'Hackeada' }).expect(404);
    await http().get(`/empresas/${empB}/usuarios`).set(t).expect(404);
    await http().get(`/empresas/${empB}/auditoria`).set(t).expect(404);
    const lista = await http().get('/empresas').set(t).expect(200);
    expect((lista.body as { id: string }[]).map((e) => e.id)).toEqual([empA]);

    await http().post('/empresas').set(t).send({ razaoSocial: 'Empresa do cliente', cnpj: cnpjFicticio() }).expect(403);
    const pedidos = await http().get('/exclusoes').set(t).expect(200);
    expect(pedidos.body).toEqual([]);
    await http().post(`/exclusoes/${crypto.randomUUID()}/decidir`).set(t)
      .send({ aprovar: true, stepUp: crypto.randomUUID() }).expect(403);
  });

  it('SUPERADMIN cria empresa com CNPJ válido; CNPJ repetido não vira oráculo', async () => {
    const sup = await entrar(await criarUsuario('acesso-super-cria'));
    await admin.query('update core.usuarios set superadmin = true where email = $1', [sup.email]);
    const cnpj = cnpjFicticio();
    const criada = await http().post('/empresas').set(bearer(sup.token)).send({ razaoSocial: 'Empresa criada no e2e', cnpj }).expect(201);
    const id = (criada.body as { id: string }).id;
    await http().get(`/empresas/${id}`).set(bearer(sup.token)).expect(200);
    const repetida = await http().post('/empresas').set(bearer(sup.token)).send({ razaoSocial: 'Outra', cnpj });
    expect(repetida.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(repetida.body)).not.toMatch(/constraint|core\.|_key|_idx|duplicate/i);
  });

  it('cookie sem token CSRF não salva vínculo', async () => {
    const login = await http().post('/auth/login').send({ email: a.email, senha: SENHA, plataforma: 'web' }).expect(200);
    const ck = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await http().put(`/vinculos/${crypto.randomUUID()}`).set('Cookie', ck)
      .send({ papel: 'OPERADOR', ativo: true, permissoes: [], stepUp: crypto.randomUUID() }).expect(403);
  });

  // CA-5 (Prompt 1.4): o que foi salvo permanece depois de sair e entrar de novo.
  it('persistência: perfil e acesso salvos continuam depois de sair e entrar de novo', async () => {
    const email = await criarUsuario('acesso-persiste');
    const emp = await criarEmpresa('Empresa e2e persistência');
    await vincular(email, emp, 'CLIENTE', ['empresas:visualizar']);
    const entrarDe = async () => {
      const r = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
      return (r.body as { token: string }).token;
    };

    const t1 = await entrarDe();
    await http().patch('/me').set(bearer(t1)).send({ nome: 'Nome Persistido', telefone: '11999990000', oab: 'SP123456' }).expect(200);
    await http().post('/auth/logout').set(bearer(t1)).expect(204);
    await http().get('/me').set(bearer(t1)).expect(401); // a sessão encerrada não vale mais

    const t2 = await entrarDe();
    const me = (await http().get('/me').set(bearer(t2)).expect(200)).body as {
      usuario: { nome: string; telefone: string; oab: string };
      vinculos: { empresaId: string; papel: string; permissoes: string[] }[];
    };
    expect(me.usuario).toMatchObject({ nome: 'Nome Persistido', telefone: '11999990000', oab: 'SP123456' });
    expect(me.vinculos).toHaveLength(1);
    expect(me.vinculos[0]).toMatchObject({ empresaId: emp, papel: 'CLIENTE' });
    await http().get(`/empresas/${emp}`).set(bearer(t2)).expect(200);

    // CA-4: os dois acessos (criação de sessão) e a saída (revogação) ficam na auditoria.
    const aud = await admin.query<{ operation: string; n: number }>(
      `select operation, count(*)::int as n from audit.audit_log
        where table_name = 'sessoes'
          and new_data->>'usuario_id' = (select id::text from core.usuarios where email = $1)
        group by operation`, [email]);
    const porOperacao = Object.fromEntries(aud.rows.map((r) => [r.operation, r.n]));
    expect(porOperacao['INSERT']).toBe(2);
    expect(porOperacao['UPDATE']).toBeGreaterThanOrEqual(1);
  });
});
