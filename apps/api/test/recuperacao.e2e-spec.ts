import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarUsuario, ipNovo, servidor, subirApp } from './apoio.js';

// Recuperação de senha por e-mail (Prompt 1.4; spec decisões 2 a 4; T5.4).
describe('recuperação de senha', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  beforeAll(async () => {
    app = await subirApp();
  });
  afterAll(async () => {
    await app.close();
  });

  // Simula o worker: pega o job de recuperação do usuário e emite o token (só o hash vai ao banco).
  async function emitirToken(email: string): Promise<string> {
    const token = `tok-e2e-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const job = await admin.query<{ id: string }>(
      `insert into ops.jobs (tipo, payload)
       select 'email_recuperacao', jsonb_build_object('usuario_id', id) from core.usuarios where email = $1
       returning id`, [email]);
    const pego = await admin.query<{ id: string; execucao: string }>(
      `select id, execucao from ops.pegar_jobs(array['email_recuperacao'], 50) where id = $1`, [job.rows[0]?.id]);
    await admin.query(`select * from core.emitir_token_recuperacao($1, $2, sha256(convert_to($3, 'UTF8')))`,
      [pego.rows[0]?.id, pego.rows[0]?.execucao, token]);
    return token;
  }

  it('responde igual exista ou não a conta, e só enfileira e-mail para conta existente', async () => {
    const email = await criarUsuario('rec');
    const existe = await http().post('/auth/recuperar').send({ email }).expect(202);
    const naoExiste = await http().post('/auth/recuperar').send({ email: 'ninguem@teste.local' }).expect(202);
    expect(naoExiste.body).toEqual(existe.body);
    const jobs = await admin.query<{ n: string }>(
      `select count(*) as n from ops.jobs where tipo = 'email_recuperacao'
          and payload ->> 'usuario_id' = (select id::text from core.usuarios where email = $1)`, [email]);
    expect(Number(jobs.rows[0]?.n)).toBe(1);
  });

  it('link válido redefine a senha uma vez, encerra sessões e a senha antiga deixa de valer', async () => {
    const email = await criarUsuario('rec2');
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const sessao = { Authorization: `Bearer ${(login.body as { token: string }).token}` };
    const token = await emitirToken(email);
    await http().post('/auth/redefinir').send({ token, senha: 'curta' }).expect(400);
    await http().post('/auth/redefinir').send({ token, senha: '123456789012' }).expect(400);
    await http().post('/auth/redefinir').send({ token, senha: 'cavalo-bateria-grampo-novo' }).expect(204);
    await http().post('/auth/redefinir').send({ token, senha: 'cavalo-bateria-grampo-novo' }).expect(400);
    await http().get('/auth/sessao').set(sessao).expect(401);
    await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(401);
    await http().post('/auth/login').send({ email, senha: 'cavalo-bateria-grampo-novo', plataforma: 'ios' }).expect(200);
  });

  it('token inventado é recusado com a mesma mensagem', async () => {
    const r = await http().post('/auth/redefinir').send({ token: 'x'.repeat(50), senha: 'cavalo-bateria-grampo-novo' }).expect(400);
    expect(r.body).toMatchObject({ message: 'Link inválido ou expirado. Peça um novo.' });
  });

  it('troca de senha logada também recusa senha óbvia/vazada', async () => {
    const email = await criarUsuario('rec3');
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    await http().post('/auth/senha').set({ Authorization: `Bearer ${(login.body as { token: string }).token}` })
      .send({ atual: SENHA, nova: 'aaaaaaaaaaaa' }).expect(400);
  });
});

describe('CAPTCHA (Turnstile configurado)', () => {
  it('a partir da 3ª falha o login exige CAPTCHA, mesmo com a senha certa', async () => {
    const app = await subirApp({ TURNSTILE_SECRET: 'segredo-de-teste' });
    const email = await criarUsuario('captcha');
    const ip = ipNovo();
    const login = (senha: string) =>
      request(servidor(app)).post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha, plataforma: 'ios' });
    for (let i = 0; i < 3; i++) await login(`errada-${String(i)}`).expect(401);
    const r = await login(SENHA).expect(400);
    expect(r.body).toMatchObject({ message: 'CAPTCHA' });
    await app.close();
  });
});
