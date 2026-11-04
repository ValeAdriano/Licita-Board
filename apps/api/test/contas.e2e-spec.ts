import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Dados bancários e PIX (spec fase-02 §3.1, PR 3): cifrados na API, só máscara na leitura, escrita e
// revelação com step-up `dados_bancarios`, A x B em toda rota nova.
describe('contas bancárias e PIX', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Conta { email: string; token: string; uri: string }

  // Login + MFA; o fator é "envelhecido" (step-up exige ≥ 24 h).
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

  async function stepUp(c: Conta, escopo = 'dados_bancarios'): Promise<string> {
    await admin.query(`update core.fatores_mfa set ultimo_passo = 0
                        where usuario_id = (select id from core.usuarios where email = $1)`, [c.email]);
    const r = await http().post('/auth/mfa/step-up').set(bearer(c.token)).send({ codigo: totpDaUri(c.uri), escopo }).expect(200);
    const b = r.body as { stepUp: string; token: string };
    c.token = b.token;
    return b.stepUp;
  }

  const NOVA = {
    banco: '001', tipoConta: 'corrente', titularNome: 'Empresa Conta Ltda', agencia: '1234-5', conta: '56789-0',
    titularDocumento: '11.222.333/0001-81', pixTipo: 'email', pixChave: ' Financeiro@Empresa-Conta.TEST ', principal: true,
  };

  let empA: string;
  let empB: string;
  let a: Conta;
  let b: Conta;
  let contaB: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Empresa contas A');
    empB = await criarEmpresa('Empresa contas B');
    const emailA = await criarUsuario('contas-a');
    const emailB = await criarUsuario('contas-b');
    await vincular(emailA, empA);
    await vincular(emailB, empB);
    a = await entrar(emailA);
    b = await entrar(emailB);
    const suB = await stepUp(b);
    const r = await http().post(`/empresas/${empB}/contas`).set(bearer(b.token)).send({ ...NOVA, titularNome: 'Empresa B', stepUp: suB }).expect(201);
    contaB = (r.body as { id: string }).id;
  });
  afterAll(async () => {
    await app.close();
  });

  let contaA = '';

  it('cria a conta com step-up; a leitura devolve só máscara e o banco guarda só envelope', async () => {
    const su101 = await stepUp(a);
    const r = await http().post(`/empresas/${empA}/contas`).set(bearer(a.token)).send({ ...NOVA, stepUp: su101 }).expect(201);
    contaA = (r.body as { id: string }).id;

    const lista = await http().get(`/empresas/${empA}/contas`).set(bearer(a.token)).expect(200);
    const corpo = JSON.stringify(lista.body);
    expect(lista.body).toHaveLength(1);
    expect(lista.body).toMatchObject([{ id: contaA, banco: '001', tipoConta: 'corrente', pixTipo: 'email', principal: true }]);
    for (const claro of ['1234-5', '56789-0', '11222333000181', 'financeiro@empresa-conta.test', 'Financeiro']) expect(corpo).not.toContain(claro);
    expect(corpo).toContain('•');

    const linha = (await admin.query<Record<string, unknown>>('select * from core.empresa_contas where id = $1', [contaA])).rows[0];
    const bruto = JSON.stringify(linha);
    for (const claro of ['1234-5', '56789-0', '11222333000181', 'financeiro@empresa-conta.test']) expect(bruto).not.toContain(claro);
    expect(linha?.agencia_cifrada).toMatchObject({ v: 1 });
    expect(String(linha?.pix_hash)).toMatch(/^[0-9a-f]{64}$/);

    const aud = await admin.query<{ n: string }>(
      `select count(*) as n from audit.audit_log where table_name = 'empresa_contas' and empresa_id = $1
          and (new_data::text like '%1234%' or new_data::text like '%56789%' or new_data::text like '%financeiro%' or new_data::text like '%Conta Ltda%')`, [empA]);
    expect(Number(aud.rows[0]?.n)).toBe(0);
  });

  it('o administrador é avisado da alteração (notificação)', async () => {
    const n = await http().get('/notificacoes').set(bearer(a.token)).expect(200);
    expect((n.body as { titulo: string }[]).some((x) => x.titulo === 'Os dados bancários da empresa foram alterados')).toBe(true);
  });

  it('sem step-up, com step-up de outro escopo ou reutilizado: não grava', async () => {
    const t = bearer(a.token);
    await http().post(`/empresas/${empA}/contas`).set(t).send(NOVA).expect(400);
    await http().post(`/empresas/${empA}/contas`).set(t).send({ ...NOVA, pixChave: 'outro@empresa.test', stepUp: crypto.randomUUID() }).expect(403);
    const errado = await stepUp(a, 'alterar_permissoes');
    await http().post(`/empresas/${empA}/contas`).set(bearer(a.token)).send({ ...NOVA, pixChave: 'outro@empresa.test', stepUp: errado }).expect(403);
    const bom = await stepUp(a);
    await http().post(`/empresas/${empA}/contas`).set(bearer(a.token)).send({ ...NOVA, pixTipo: undefined, pixChave: undefined, principal: false, stepUp: bom }).expect(201);
    await http().post(`/empresas/${empA}/contas`).set(bearer(a.token)).send({ ...NOVA, pixTipo: undefined, pixChave: undefined, stepUp: bom }).expect(403);
    const n = await admin.query<{ n: string }>('select count(*) as n from core.empresa_contas where empresa_id = $1 and deleted_at is null', [empA]);
    expect(Number(n.rows[0]?.n)).toBe(2);
  });

  it('valida CPF/CNPJ do titular, chave PIX pelo tipo, banco e campos desconhecidos', async () => {
    const mandar = async (extra: Record<string, unknown>) =>
      http().post(`/empresas/${empA}/contas`).set(bearer(a.token)).send({ ...NOVA, pixChave: 'dup@empresa.test', stepUp: crypto.randomUUID(), ...extra });
    expect((await mandar({ titularDocumento: '11222333000182' })).status).toBe(400);
    expect((await mandar({ pixTipo: 'cpf', pixChave: '52998224726' })).status).toBe(400);
    expect((await mandar({ pixTipo: 'email', pixChave: 'sem-arroba' })).status).toBe(400);
    expect((await mandar({ pixTipo: 'aleatoria', pixChave: 'nao-e-uuid' })).status).toBe(400);
    expect((await mandar({ pixChave: undefined })).status).toBe(400);
    expect((await mandar({ pixTipo: undefined })).status).toBe(400);
    expect((await mandar({ banco: '1' })).status).toBe(400);
    expect((await mandar({ agencia: 'abc' })).status).toBe(400);
    expect((await mandar({ empresaId: empB })).status).toBe(400);
  });

  it('PIX repetido na mesma empresa (mesmo tipo e chave, em qualquer caixa) é recusado com 409', async () => {
    const su1 = await stepUp(a);
    const r = await http().post(`/empresas/${empA}/contas`).set(bearer(a.token))
      .send({ ...NOVA, pixChave: 'FINANCEIRO@empresa-conta.test', principal: false, stepUp: su1 });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).not.toMatch(/pix_hash|empresa_contas|_uk|constraint/i);
  });

  it('revelar: step-up, valor decifrado, registro auditado e token de uso único', async () => {
    const su = await stepUp(a);
    const r = await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'agencia', stepUp: su }).expect(200);
    expect(r.body).toEqual({ campo: 'agencia', valor: '1234-5' });
    await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'agencia', stepUp: su }).expect(403);
    const su102 = await stepUp(a);
    const doc = await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'titular_documento', stepUp: su102 }).expect(200);
    expect(doc.body).toEqual({ campo: 'titular_documento', valor: '11222333000181' });
    const su103 = await stepUp(a);
    const pix = await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'pix_chave', stepUp: su103 }).expect(200);
    expect(pix.body).toEqual({ campo: 'pix_chave', valor: 'financeiro@empresa-conta.test' });
    const su2 = await stepUp(a);
    await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'senha', stepUp: su2 }).expect(400);
    const rev = await admin.query<{ campo: string }>('select campo from core.revelacoes_dados where empresa_id = $1 order by created_at', [empA]);
    expect(rev.rows.map((x) => x.campo)).toEqual(['agencia', 'titular_documento', 'pix_chave']);
    const aud = await admin.query<{ n: string }>(
      `select count(*) as n from audit.audit_log where table_name = 'revelacoes_dados' and operation = 'INSERT' and empresa_id = $1`, [empA]);
    expect(Number(aud.rows[0]?.n)).toBe(3);
  });

  it('editar: só o que veio muda; pixTipo nulo remove o PIX; novo PIX troca o conjunto', async () => {
    const su3 = await stepUp(a);
    let r = await http().patch(`/empresas/${empA}/contas/${contaA}`).set(bearer(a.token)).send({ titularNome: 'Empresa Renomeada', stepUp: su3 }).expect(200);
    expect(r.body).toEqual({});
    let linha = (await http().get(`/empresas/${empA}/contas`).set(bearer(a.token))).body as { id: string; titularNome: string; pixTipo: string | null; agenciaMascara: string }[];
    expect(linha.find((c) => c.id === contaA)).toMatchObject({ titularNome: 'Empresa Renomeada', pixTipo: 'email' });
    const su4 = await stepUp(a);
    r = await http().patch(`/empresas/${empA}/contas/${contaA}`).set(bearer(a.token)).send({ pixTipo: null, stepUp: su4 }).expect(200);
    linha = (await http().get(`/empresas/${empA}/contas`).set(bearer(a.token))).body as typeof linha;
    expect(linha.find((c) => c.id === contaA)?.pixTipo).toBeNull();
    const su5 = await stepUp(a);
    await http().patch(`/empresas/${empA}/contas/${contaA}`).set(bearer(a.token)).send({ pixTipo: 'cpf', pixChave: '529.982.247-25', stepUp: su5 }).expect(200);
    const su104 = await stepUp(a);
    const pix = await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'pix_chave', stepUp: su104 }).expect(200);
    expect(pix.body).toEqual({ campo: 'pix_chave', valor: '52998224725' });
    const su6 = await stepUp(a);
    await http().patch(`/empresas/${empA}/contas/${contaA}`).set(bearer(a.token)).send({ pixChave: 'solta@empresa.test', stepUp: su6 }).expect(400);
  });

  it('A x B: nenhuma rota de contas da empresa B responde para A; o id de B não funciona pela rota de A', async () => {
    const t = bearer(a.token);
    await http().get(`/empresas/${empB}/contas`).set(t).expect(404);
    await http().post(`/empresas/${empB}/contas`).set(t).send({ ...NOVA, stepUp: crypto.randomUUID() }).expect(404);
    await http().patch(`/empresas/${empB}/contas/${contaB}`).set(t).send({ titularNome: 'Hack', stepUp: crypto.randomUUID() }).expect(404);
    await http().post(`/empresas/${empB}/contas/${contaB}/revelar`).set(t).send({ campo: 'conta', stepUp: crypto.randomUUID() }).expect(404);
    await http().post(`/empresas/${empB}/contas/${contaB}/remover`).set(t).send({ stepUp: crypto.randomUUID() }).expect(404);
    // Com a empresa certa (A) e o id de B: o banco não acha a conta (404), sem gastar o step-up.
    const su = await stepUp(a);
    await http().patch(`/empresas/${empA}/contas/${contaB}`).set(bearer(a.token)).send({ titularNome: 'Hack', stepUp: su }).expect(404);
    await http().post(`/empresas/${empA}/contas/${contaB}/revelar`).set(bearer(a.token)).send({ campo: 'conta', stepUp: su }).expect(404);
    await http().post(`/empresas/${empA}/contas/${contaB}/remover`).set(bearer(a.token)).send({ stepUp: su }).expect(404);
    const naB = await admin.query<{ titular_nome: string; deleted_at: Date | null }>('select titular_nome, deleted_at from core.empresa_contas where id = $1', [contaB]);
    expect(naB.rows[0]).toMatchObject({ titular_nome: 'Empresa B', deleted_at: null });
    expect((await http().get(`/empresas/${empB}/contas`).set(bearer(b.token))).body).toHaveLength(1);
  });

  it('OPERADOR só com empresas:visualizar vê as máscaras e não grava nem revela', async () => {
    const emailOp = await criarUsuario('contas-op');
    await vincular(emailOp, empA, 'OPERADOR', ['empresas:visualizar']);
    const op = await entrar(emailOp);
    await http().get(`/empresas/${empA}/contas`).set(bearer(op.token)).expect(200);
    for (const tentar of [
      async () => http().post(`/empresas/${empA}/contas`).set(bearer(op.token)).send({ ...NOVA, stepUp: crypto.randomUUID() }),
      async () => http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(op.token)).send({ campo: 'conta', stepUp: crypto.randomUUID() }),
      async () => http().post(`/empresas/${empA}/contas/${contaA}/remover`).set(bearer(op.token)).send({ stepUp: crypto.randomUUID() }),
    ]) {
      expect([403, 404]).toContain((await tentar()).status);
    }
  });

  it('envelope copiado para outra coluna não decifra (contexto autenticado): erro genérico, sem vazar dado', async () => {
    await admin.query('update core.empresa_contas set agencia_cifrada = conta_cifrada where id = $1', [contaA]);
    const su105 = await stepUp(a);
    const r = await http().post(`/empresas/${empA}/contas/${contaA}/revelar`).set(bearer(a.token)).send({ campo: 'agencia', stepUp: su105 });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/56789|1234/);
  });

  it('remover: soft delete com step-up e aviso aos administradores', async () => {
    const su7 = await stepUp(a);
    await http().post(`/empresas/${empA}/contas/${contaA}/remover`).set(bearer(a.token)).send({ stepUp: su7 }).expect(204);
    const su8 = await stepUp(a);
    await http().post(`/empresas/${empA}/contas/${contaA}/remover`).set(bearer(a.token)).send({ stepUp: su8 }).expect(404);
    const lista = (await http().get(`/empresas/${empA}/contas`).set(bearer(a.token))).body as { id: string }[];
    expect(lista.some((c) => c.id === contaA)).toBe(false);
    const n = await http().get('/notificacoes').set(bearer(a.token)).expect(200);
    expect((n.body as { titulo: string }[]).some((x) => x.titulo === 'Uma conta bancária da empresa foi removida')).toBe(true);
  });
});
