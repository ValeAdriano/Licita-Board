import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarUsuario, ipNovo, servidor, subirApp } from './apoio.js';

// Web Push (PR 9, ADR-018): dispositivo é do dono (A x B), a API nunca devolve endpoint nem chaves,
// só serviços de push conhecidos (SSRF), no máximo 10 por usuário e logout revoga.
const CHAVE = 'B'.repeat(87);
const SEGREDO = 'A'.repeat(22);
const VAPID = 'C'.repeat(87);
const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}-${crypto.randomUUID()}`;

describe('push', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await subirApp({ VAPID_PUBLIC_KEY: VAPID });
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function entrar(prefixo: string): Promise<string> {
    const email = await criarUsuario(prefixo);
    const r = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    return (r.body as { token: string }).token;
  }
  const inscricao = (ep: string) => ({ endpoint: ep, chaves: { p256dh: CHAVE, auth: SEGREDO } });

  it('publica só a chave pública, exige sessão e some quando o push está desligado', async () => {
    await http().get('/push/chave').expect(401);
    const t = await entrar('push-chave');
    const r = await http().get('/push/chave').set(bearer(t)).expect(200);
    expect(r.body).toEqual({ chave: VAPID });
    const desligado = await subirApp({ VAPID_PUBLIC_KEY: '' });
    try {
      await request(servidor(desligado)).get('/push/chave').set(bearer(t)).set('X-Forwarded-For', ipNovo()).expect(404);
    } finally {
      await desligado.close();
    }
  });

  it('registra, lista sem endpoint nem chaves, reconhece o navegador e revoga pelo logout', async () => {
    const t = await entrar('push-a');
    const ep = endpoint('a');
    const reg = await http().post('/dispositivos-push').set(bearer(t)).send(inscricao(ep)).expect(201);
    const id = (reg.body as { id: string }).id;
    const lista = await http().get('/dispositivos-push').set(bearer(t)).expect(200);
    expect(lista.body as unknown[]).toHaveLength(1);
    const texto = JSON.stringify(lista.body);
    expect(texto).not.toContain(ep);
    expect(texto).not.toContain(CHAVE);
    expect(Object.keys((lista.body as object[])[0] ?? {}).sort()).toEqual(['criadoEm', 'id', 'ultimoEnvioEm', 'userAgent']);
    const consulta = await http().post('/dispositivos-push/consulta').set(bearer(t)).send({ endpoint: ep }).expect(200);
    expect(consulta.body).toEqual({ id });
    await http().post('/dispositivos-push/revogar').set(bearer(t)).send({ endpoint: ep }).expect(204);
    await http().post('/dispositivos-push/revogar').set(bearer(t)).send({ endpoint: ep }).expect(204); // idempotente
    expect((await http().get('/dispositivos-push').set(bearer(t)).expect(200)).body as unknown[]).toHaveLength(0);
  });

  it('A x B: B não vê, não reconhece nem revoga o dispositivo de A', async () => {
    const a = await entrar('push-ab-a');
    const b = await entrar('push-ab-b');
    const ep = endpoint('ab');
    const id = ((await http().post('/dispositivos-push').set(bearer(a)).send(inscricao(ep)).expect(201)).body as { id: string }).id;
    expect((await http().get('/dispositivos-push').set(bearer(b)).expect(200)).body as unknown[]).toHaveLength(0);
    expect((await http().post('/dispositivos-push/consulta').set(bearer(b)).send({ endpoint: ep }).expect(200)).body).toEqual({ id: null });
    await http().delete(`/dispositivos-push/${id}`).set(bearer(b)).expect(404);
    await http().post('/dispositivos-push/revogar').set(bearer(b)).send({ endpoint: ep }).expect(204); // sem efeito
    expect((await http().get('/dispositivos-push').set(bearer(a)).expect(200)).body as unknown[]).toHaveLength(1);
    await http().delete(`/dispositivos-push/${id}`).set(bearer(a)).expect(204);
  });

  it('recusa endpoint fora dos serviços de push (SSRF) e chaves fora do formato', async () => {
    const t = await entrar('push-ssrf');
    for (const ep of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com@evil.example.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest']) {
      await http().post('/dispositivos-push').set(bearer(t)).send(inscricao(ep)).expect(400);
    }
    await http().post('/dispositivos-push').set(bearer(t)).send({ endpoint: endpoint('k'), chaves: { p256dh: 'curta', auth: SEGREDO } }).expect(400);
    await http().post('/dispositivos-push').set(bearer(t)).send({ ...inscricao(endpoint('x')), extra: 1 }).expect(400);
    expect((await http().get('/dispositivos-push').set(bearer(t)).expect(200)).body as unknown[]).toHaveLength(0);
  });

  it('no máximo 10 dispositivos por usuário (o 11º recebe 429)', async () => {
    const t = await entrar('push-limite');
    for (let i = 0; i < 10; i++) await http().post('/dispositivos-push').set(bearer(t)).send(inscricao(endpoint(`l${String(i)}`))).expect(201);
    await http().post('/dispositivos-push').set(bearer(t)).send(inscricao(endpoint('l10'))).expect(429);
  });

  it('quem só sabe a URL do endpoint (chaves diferentes) não sequestra o dispositivo de outra conta', async () => {
    const a = await entrar('push-sq-a');
    const b = await entrar('push-sq-b');
    const ep = endpoint('sq');
    await http().post('/dispositivos-push').set(bearer(a)).send(inscricao(ep)).expect(201);
    await http().post('/dispositivos-push').set(bearer(b)).send({ endpoint: ep, chaves: { p256dh: 'D'.repeat(87), auth: 'E'.repeat(22) } }).expect(403);
    expect((await http().get('/dispositivos-push').set(bearer(a)).expect(200)).body as unknown[]).toHaveLength(1);
    expect((await http().get('/dispositivos-push').set(bearer(b)).expect(200)).body as unknown[]).toHaveLength(0);
  });

  it('o mesmo navegador em outra conta (mesmas chaves) passa a ser da conta nova e a anterior perde o alerta', async () => {
    const a = await entrar('push-troca-a');
    const b = await entrar('push-troca-b');
    const ep = endpoint('troca');
    await http().post('/dispositivos-push').set(bearer(a)).send(inscricao(ep)).expect(201);
    await http().post('/dispositivos-push').set(bearer(b)).send(inscricao(ep)).expect(201);
    expect((await http().get('/dispositivos-push').set(bearer(a)).expect(200)).body as unknown[]).toHaveLength(0);
    expect((await http().get('/dispositivos-push').set(bearer(b)).expect(200)).body as unknown[]).toHaveLength(1);
    const donos = await admin.query<{ n: number }>('select count(*)::int as n from core.dispositivos_push where endpoint = $1 and revogado_em is null', [ep]);
    expect(donos.rows[0]?.n).toBe(1);
  });

  it('limite por IP nas rotas de inscrição (21º pedido do mesmo IP no minuto recebe 429)', async () => {
    const t = await entrar('push-ip');
    const ip = ipNovo();
    let ultimo = 0;
    for (let i = 0; i < 21; i++) {
      const r = await request(servidor(app)).post('/dispositivos-push/consulta').set('X-Forwarded-For', ip).set(bearer(t)).send({ endpoint: endpoint('ip') });
      ultimo = r.status;
    }
    expect(ultimo).toBe(429);
  });
});
