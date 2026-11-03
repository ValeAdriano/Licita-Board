import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarUsuario, ipNovo, servidor, subirApp, totpDaUri } from './apoio.js';

// MFA ponta a ponta (spec fase-01 decisões 1 e 7; CA-7): cadastro, confirmação com rotação do token,
// verificação no login seguinte, replay, força bruta e códigos de recuperação.
describe('mfa', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await subirApp();
  });
  afterAll(async () => {
    await app.close();
  });

  // IP fictício novo por requisição: o limite de 20/min por IP nas rotas de MFA é real.
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function loginNativo(email: string): Promise<{ token: string; mfa: string }> {
    const res = await http().post('/auth/login').set('X-Forwarded-For', ipNovo())
      .send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    return res.body as { token: string; mfa: string };
  }

  async function cadastrarEConfirmar(email: string): Promise<{ uri: string; token: string; codigo: string }> {
    const { token } = await loginNativo(email);
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(token)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    const codigo = totpDaUri(uri);
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(token)).send({ codigo }).expect(200);
    return { uri, codigo, token: (conf.body as { token: string }).token };
  }

  it('perfil interno: cadastra, confirma, recebe token novo e passa a gerir a conta', async () => {
    const email = await criarUsuario('mfa1', { interno: true });
    const { token, mfa } = await loginNativo(email);
    expect(mfa).toBe('cadastrar');
    await http().get('/auth/sessoes').set(bearer(token)).expect(403);
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(token)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    await http().post('/auth/mfa/confirmar').set(bearer(token)).send({ codigo: '000000' }).expect(400);
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(token)).send({ codigo: totpDaUri(uri) }).expect(200);
    const novo = (conf.body as { token: string }).token;
    expect(novo).not.toBe(token);
    await http().get('/auth/sessao').set(bearer(token)).expect(401);
    await http().get('/auth/sessoes').set(bearer(novo)).expect(200);
  });

  it('login seguinte pede verificação; o mesmo código não serve duas vezes', async () => {
    const email = await criarUsuario('mfa2', { interno: true });
    const { uri, codigo } = await cadastrarEConfirmar(email);
    const segundo = await loginNativo(email);
    expect(segundo.mfa).toBe('verificar');
    await http().post('/auth/mfa/verificar').set(bearer(segundo.token)).send({ codigo }).expect(400);
    const ok = await http().post('/auth/mfa/verificar').set(bearer(segundo.token))
      .send({ codigo: totpDaUri(uri, 1) }).expect(200);
    await http().get('/auth/sessoes').set(bearer((ok.body as { token: string }).token)).expect(200);
  });

  it('5 códigos errados encerram a sessão', async () => {
    const email = await criarUsuario('mfa3', { interno: true });
    await cadastrarEConfirmar(email);
    const { token } = await loginNativo(email);
    for (let i = 0; i < 4; i++) {
      await http().post('/auth/mfa/verificar').set(bearer(token)).send({ codigo: '000000' }).expect(400);
    }
    await http().post('/auth/mfa/verificar').set(bearer(token)).send({ codigo: '000000' }).expect(400);
    await http().get('/auth/sessao').set(bearer(token)).expect(401);
  });

  it('códigos de recuperação: gerados com MFA recente, valem uma vez e elevam a sessão', async () => {
    const email = await criarUsuario('mfa4', { interno: true });
    const { token } = await cadastrarEConfirmar(email);
    const gerados = await http().post('/auth/mfa/codigos').set(bearer(token)).expect(200);
    const codigos = (gerados.body as { codigos: string[] }).codigos;
    expect(codigos).toHaveLength(10);
    const { token: t2 } = await loginNativo(email);
    await http().post('/auth/mfa/codigos').set(bearer(t2)).expect(403);
    const usado = await http().post('/auth/mfa/recuperacao').set(bearer(t2)).send({ codigo: codigos[0] }).expect(200);
    await http().get('/auth/sessoes').set(bearer((usado.body as { token: string }).token)).expect(200);
    const { token: t3 } = await loginNativo(email);
    await http().post('/auth/mfa/recuperacao').set(bearer(t3)).send({ codigo: codigos[0] }).expect(400);
  });

  it('sessão só com senha não troca o autenticador de quem já tem MFA', async () => {
    const email = await criarUsuario('mfa5', { interno: true });
    await cadastrarEConfirmar(email);
    const { token } = await loginNativo(email);
    await http().post('/auth/mfa/cadastrar').set(bearer(token)).send({ senha: SENHA }).expect(403);
  });

  it('web: confirmar troca o cookie de sessão', async () => {
    const email = await criarUsuario('mfa6');
    const login = await http().post('/auth/login').set('X-Forwarded-For', ipNovo())
      .send({ email, senha: SENHA, plataforma: 'web' }).expect(200);
    const ck = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    const csrf = (login.body as { csrf: string }).csrf;
    await http().post('/auth/mfa/cadastrar').set('Cookie', ck).send({ senha: SENHA }).expect(403);
    const cad = await http().post('/auth/mfa/cadastrar').set('Cookie', ck).set('x-csrf-token', csrf).send({ senha: SENHA }).expect(200);
    const conf = await http().post('/auth/mfa/confirmar').set('Cookie', ck).set('x-csrf-token', csrf)
      .send({ codigo: totpDaUri((cad.body as { uri: string }).uri) }).expect(200);
    const novo = (conf.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('__Host-sessao='));
    expect(novo).toBeDefined();
    expect(conf.body).not.toHaveProperty('token');
    await http().get('/auth/sessao').set('Cookie', ck).expect(401);
  });

  it('cadastrar exige a senha atual', async () => {
    const { token } = await loginNativo(await criarUsuario('mfa7'));
    await http().post('/auth/mfa/cadastrar').set(bearer(token)).send({ senha: 'errada' }).expect(400);
    await http().post('/auth/mfa/cadastrar').set(bearer(token)).send({}).expect(400);
  });

  it('outra sessão do mesmo usuário não derruba o cadastro em andamento', async () => {
    const email = await criarUsuario('mfa8', { interno: true });
    const dono = (await loginNativo(email)).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(dono)).send({ senha: SENHA }).expect(200);
    const intruso = (await loginNativo(email)).token;
    await http().post('/auth/mfa/cadastrar').set(bearer(intruso)).send({ senha: SENHA }).expect(200);
    await http().post('/auth/mfa/confirmar').set(bearer(dono))
      .send({ codigo: totpDaUri((cad.body as { uri: string }).uri) }).expect(200);
  });

  it('verificar e recuperação também trocam o token; código aceito com hífens e minúsculas', async () => {
    const email = await criarUsuario('mfa9', { interno: true });
    const { uri, token } = await cadastrarEConfirmar(email);
    const codigos = ((await http().post('/auth/mfa/codigos').set(bearer(token)).expect(200)).body as { codigos: string[] }).codigos;
    const t1 = (await loginNativo(email)).token;
    await http().post('/auth/mfa/verificar').set(bearer(t1)).send({ codigo: totpDaUri(uri, 1) }).expect(200);
    await http().get('/auth/sessao').set(bearer(t1)).expect(401);
    const t2 = (await loginNativo(email)).token;
    const digitado = (codigos[1] ?? '').toLowerCase().replace(/(.{5})(?!$)/g, '$1-');
    await http().post('/auth/mfa/recuperacao').set(bearer(t2)).send({ codigo: digitado }).expect(200);
    await http().get('/auth/sessao').set(bearer(t2)).expect(401);
  });

  it('SUPERADMIN com MFA recente reseta o MFA de outro usuário', async () => {
    const alvo = await criarUsuario('mfa10', { interno: true });
    await cadastrarEConfirmar(alvo);
    const adm = await criarUsuario('mfa-adm');
    await admin.query('update core.usuarios set superadmin = true where email = $1', [adm]);
    const { token } = await cadastrarEConfirmar(adm);
    const id = await admin.query<{ id: string }>('select id from core.usuarios where email = $1', [alvo]);
    await http().post(`/auth/mfa/resetar/${id.rows[0]?.id ?? ''}`).set(bearer(token)).expect(204);
    // A senha do alvo é invalidada: quem a tinha não chega antes do dono (que volta pela recuperação).
    await http().post('/auth/login').send({ email: alvo, senha: SENHA, plataforma: 'ios' }).expect(401);
  });
});
