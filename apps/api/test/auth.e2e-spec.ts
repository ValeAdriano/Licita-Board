import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cookies, criarUsuario, ipNovo, servidor, subirApp, valorCookie } from './apoio.js';

// Ataques e fluxos de sessão da Fase 01 (spec CA-7, ADR-012). Cada teste usa um IP fictício próprio
// (X-Forwarded-For com proxy de loopback confiável, como o Caddy em produção).
describe('auth', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await subirApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(servidor(app));

  function login(email: string, plataforma: 'web' | 'ios', ip = ipNovo(), senha = SENHA) {
    return http().post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha, plataforma });
  }

  async function loginWeb(email: string) {
    const res = await login(email, 'web').expect(200);
    const lista = cookies(res);
    return { res, sessao: valorCookie(lista, '__Host-sessao') ?? '', csrf: valorCookie(lista, '__Host-csrf') ?? '' };
  }

  async function loginNativo(email: string): Promise<string> {
    const res = await login(email, 'ios').expect(200);
    return (res.body as { token: string }).token;
  }

  it('web: sessão só em cookie __Host- HttpOnly, Secure, SameSite=Strict, e no-store', async () => {
    const { res, sessao } = await loginWeb(await criarUsuario('web'));
    const cookie = cookies(res).find((c) => c.startsWith('__Host-sessao='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(sessao.length).toBeGreaterThan(40);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).toMatchObject({ mfa: 'nao_requerido' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('senha errada, e-mail inexistente e conta bloqueada respondem igual', async () => {
    const email = await criarUsuario('enum');
    const errada = await login(email, 'web', ipNovo(), 'x');
    const inexistente = await login('ninguem@teste.local', 'web', ipNovo(), 'x');
    const bloqueada = await criarUsuario('bloqueada');
    await admin.query(`update core.usuarios set bloqueado_ate = now() + interval '10 minutes' where email = $1`, [bloqueada]);
    const comBloqueio = await login(bloqueada, 'web', ipNovo());
    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(comBloqueio.status).toBe(401);
    expect(inexistente.body).toEqual(errada.body);
    expect(comBloqueio.body).toEqual(errada.body);
    expect(cookies(errada)).toHaveLength(0);
  });

  it('login CSRF: formulário urlencoded e Origin de outro site não criam sessão', async () => {
    const email = await criarUsuario('logincsrf');
    await http().post('/auth/login').set('X-Forwarded-For', ipNovo()).type('form')
      .send({ email, senha: SENHA, plataforma: 'web' }).expect(400);
    await http().post('/auth/login').set('X-Forwarded-For', ipNovo()).set('Origin', 'https://atacante.example')
      .send({ email, senha: SENHA, plataforma: 'web' }).expect(403);
    await http().post('/auth/login').set('X-Forwarded-For', ipNovo()).set('Sec-Fetch-Site', 'cross-site')
      .send({ email, senha: SENHA, plataforma: 'web' }).expect(403);
    await http().post('/auth/login').set('X-Forwarded-For', ipNovo()).set('Origin', 'http://localhost:8081')
      .send({ email, senha: SENHA, plataforma: 'web' }).expect(200);
  });

  it('corpo acima de 16 kB é recusado', async () => {
    await http().post('/auth/login').send({ email: 'a@teste.local', senha: 'x'.repeat(20_000), plataforma: 'web' })
      .expect(413);
  });

  it('nativo: token no corpo e Bearer dispensa CSRF', async () => {
    const token = await loginNativo(await criarUsuario('nativo'));
    await http().get('/auth/sessao').set('Authorization', `Bearer ${token}`).expect(200);
    await http().post('/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    await http().get('/auth/sessao').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('cookie sem token CSRF não altera estado; com o token, altera', async () => {
    const { sessao, csrf } = await loginWeb(await criarUsuario('csrf'));
    const ck = `__Host-sessao=${sessao}; __Host-csrf=${csrf}`;
    await http().post('/auth/logout').set('Cookie', ck).expect(403);
    await http().post('/auth/logout').set('Cookie', ck).set('x-csrf-token', 'outro').expect(403);
    await http().delete(`/auth/sessoes/${crypto.randomUUID()}`).set('Cookie', ck).expect(403);
    await http().post('/auth/senha').set('Cookie', ck).send({ atual: SENHA, nova: 'outra-senha-longa' }).expect(403);
    await http().post('/auth/logout').set('Cookie', ck).set('x-csrf-token', csrf).expect(204);
    await http().get('/auth/sessao').set('Cookie', ck).expect(401);
  });

  it('fixação de sessão: login ignora o cookie anterior e emite token novo', async () => {
    const res = await http().post('/auth/login').set('X-Forwarded-For', ipNovo()).set('Cookie', '__Host-sessao=token-do-atacante')
      .send({ email: await criarUsuario('fixacao'), senha: SENHA, plataforma: 'web' }).expect(200);
    const novo = valorCookie(cookies(res), '__Host-sessao');
    expect(novo).toBeDefined();
    expect(novo).not.toBe('token-do-atacante');
    await http().get('/auth/sessao').set('Cookie', '__Host-sessao=token-do-atacante').expect(401);
  });

  it('força bruta: 10 falhas bloqueiam, e uma rajada paralela com a senha certa não fura o bloqueio', async () => {
    const email = await criarUsuario('bruta');
    for (let i = 0; i < 9; i++) await login(email, 'web', ipNovo(), `errada-${String(i)}`).expect(401);
    const rajada = await Promise.all(
      Array.from({ length: 12 }, (_, i) => login(email, 'web', ipNovo(), i === 6 ? SENHA : `errada-r${String(i)}`)),
    );
    // 503 = Argon2 no limite de simultâneos (resposta rápida, sem dizer se a senha estava certa).
    expect(rajada.map((r) => r.status).filter((s) => ![401, 200, 503].includes(s))).toEqual([]);
    expect(rajada.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    await login(email, 'web').expect(401);
  });

  it('limite por IP: o 11º pedido no minuto recebe 429, mesmo com a senha certa', async () => {
    const ip = ipNovo();
    for (let i = 0; i < 10; i++) await login(`spray${String(i)}@teste.local`, 'web', ip, 'x').expect(401);
    await login(await criarUsuario('spray'), 'web', ip).expect(429);
  });

  it('perfil interno só com a senha (aal1) não gere a conta', async () => {
    const email = await criarUsuario('interno', { interno: true });
    const res = await login(email, 'ios').expect(200);
    expect(res.body).toMatchObject({ mfa: 'cadastrar' });
    const auth = { Authorization: `Bearer ${(res.body as { token: string }).token}` };
    await http().get('/auth/sessao').set(auth).expect(200);
    await http().get('/auth/sessoes').set(auth).expect(403);
    await http().post('/auth/senha').set(auth).send({ atual: SENHA, nova: 'nova-senha-bem-longa' }).expect(403);
    await http().post('/auth/logout-todas').set(auth).send({}).expect(403);
    await http().post('/auth/logout').set(auth).expect(204);
  });

  it('troca de senha: confere a atual, conta erros, troca o token e encerra as outras sessões', async () => {
    const email = await criarUsuario('troca');
    const outra = await loginNativo(email);
    const atual = await loginNativo(email);
    const auth = { Authorization: `Bearer ${atual}` };
    await http().post('/auth/senha').set(auth).send({ atual: 'errada', nova: 'nova-senha-bem-longa' }).expect(400);
    await http().post('/auth/senha').set(auth).send({ atual: SENHA, nova: 'curta' }).expect(400);
    const ok = await http().post('/auth/senha').set(auth).send({ atual: SENHA, nova: 'nova-senha-bem-longa' }).expect(200);
    const novo = (ok.body as { token: string }).token;
    expect(novo).not.toBe(atual);
    await http().get('/auth/sessao').set(auth).expect(401);
    await http().get('/auth/sessao').set('Authorization', `Bearer ${novo}`).expect(200);
    await http().get('/auth/sessao').set('Authorization', `Bearer ${outra}`).expect(401);
  });

  it('5 senhas atuais erradas na troca encerram a sessão', async () => {
    const auth = { Authorization: `Bearer ${await loginNativo(await criarUsuario('trocabruta'))}` };
    for (let i = 0; i < 5; i++) {
      await http().post('/auth/senha').set(auth).send({ atual: `errada-${String(i)}`, nova: 'nova-senha-bem-longa' }).expect(400);
    }
    await http().get('/auth/sessao').set(auth).expect(401);
  });

  it('sessões: lista as próprias, encerra outra pelo id e não toca sessão de outro usuário', async () => {
    const email = await criarUsuario('sessoes');
    const a = await loginNativo(email);
    const b = await loginNativo(email);
    const alheia = await loginNativo(await criarUsuario('alheio'));
    const lista = await http().get('/auth/sessoes').set('Authorization', `Bearer ${a}`).expect(200);
    const sessoes = lista.body as { id: string; atual: boolean }[];
    expect(sessoes).toHaveLength(2);
    const outra = sessoes.find((s) => !s.atual);
    const idAlheia = await admin.query<{ id: string }>(
      'select id from core.sessoes where token_hash = core.hash_token($1)', [alheia]);
    await http().delete(`/auth/sessoes/${idAlheia.rows[0]?.id ?? ''}`).set('Authorization', `Bearer ${a}`).expect(204);
    await http().get('/auth/sessao').set('Authorization', `Bearer ${alheia}`).expect(200);
    await http().delete(`/auth/sessoes/${outra?.id ?? ''}`).set('Authorization', `Bearer ${a}`).expect(204);
    await http().get('/auth/sessao').set('Authorization', `Bearer ${b}`).expect(401);
  });

  it('consulta de fundo (X-VV-Fundo: 1) confere a sessão sem renovar a inatividade', async () => {
    const token = await loginNativo(await criarUsuario('fundo'));
    const ultimoUso = async () => (await admin.query<{ minutos: number }>(
      `select (extract(epoch from now() - ultimo_uso_em) / 60)::int as minutos from core.sessoes
        where token_hash = core.hash_token($1)`, [token])).rows[0]?.minutos ?? 0;
    await admin.query(`update core.sessoes set ultimo_uso_em = now() - interval '10 minutes'
                        where token_hash = core.hash_token($1)`, [token]);
    await http().get('/notificacoes').set('Authorization', `Bearer ${token}`).set('X-VV-Fundo', '1').expect(200);
    expect(await ultimoUso()).toBeGreaterThanOrEqual(9);
    await http().get('/notificacoes').set('Authorization', `Bearer ${token}`).expect(200);
    expect(await ultimoUso()).toBeLessThan(1);
    // Ação (método que altera) sempre conta como uso, mesmo com o cabeçalho.
    await admin.query(`update core.sessoes set ultimo_uso_em = now() - interval '10 minutes'
                        where token_hash = core.hash_token($1)`, [token]);
    await http().post(`/notificacoes/${crypto.randomUUID()}/lida`).set('Authorization', `Bearer ${token}`)
      .set('X-VV-Fundo', '1').expect(204);
    expect(await ultimoUso()).toBeLessThan(1);
  });

  it('proxy confiável: o IP do X-Forwarded-For escrito pelo Caddy é o registrado', async () => {
    const ip = ipNovo();
    await login('quem@teste.local', 'web', ip, 'x').expect(401);
    const r = await admin.query<{ ip: string | null }>(
      `select host(ip) as ip from core.tentativas_login where email_hash = core.hash_token('quem@teste.local') order by em desc limit 1`);
    expect(r.rows[0]?.ip).toBe(ip);
  });
});

describe('auth sem proxy confiável', () => {
  it('X-Forwarded-For do cliente não vira o IP registrado', async () => {
    const app = await subirApp({ TRUST_PROXY: 'false' });
    await request(servidor(app)).post('/auth/login').set('X-Forwarded-For', '6.6.6.6')
      .send({ email: 'xff@teste.local', senha: 'x', plataforma: 'web' }).expect(401);
    const r = await admin.query<{ ip: string | null }>(
      `select host(ip) as ip from core.tentativas_login where email_hash = core.hash_token('xff@teste.local') order by em desc limit 1`);
    expect(r.rows[0]?.ip).not.toBe('6.6.6.6');
    await app.close();
  });
});
