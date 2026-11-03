import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, criarUsuario, ipNovo, servidor, subirApp } from './apoio.js';

// Cobertura de rotas (ADR-013, AGENTS.md §3.13): toda rota registrada exige sessão, exceto a lista
// fechada de públicas. Rota nova pública fora da lista faz este teste falhar.
const PUBLICAS = new Set(['POST /auth/login', 'GET /health']);
// Rotas liberadas a quem só passou da senha (aal1) e tem/precisa de MFA. Fora daqui: 403.
const PERMITE_AAL1 = new Set(['GET /auth/sessao', 'POST /auth/logout']);

interface Camada { route?: { path: string; methods: Record<string, boolean> } }

describe('cobertura de rotas', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await subirApp();
  });
  afterAll(async () => {
    await app.close();
  });

  function rotasRegistradas(): string[] {
    const express = (app as NestExpressApplication).getHttpAdapter().getInstance() as { router: { stack: Camada[] } };
    return express.router.stack.flatMap((c) =>
      c.route && !c.route.path.includes('{')
        ? Object.keys(c.route.methods).map((m) => `${m.toUpperCase()} ${c.route?.path ?? ''}`)
        : []);
  }

  it('perfil interno em aal1 só passa nas rotas da lista fechada', async () => {
    const email = await criarUsuario('aal1rotas', { interno: true });
    const liberadas: string[] = [];
    for (const rota of rotasRegistradas().filter((r) => !PUBLICAS.has(r))) {
      const login = await request(servidor(app)).post('/auth/login').set('X-Forwarded-For', ipNovo())
        .send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
      const token = (login.body as { token: string }).token;
      const [metodo = 'GET', caminho = '/'] = rota.split(' ');
      const url = caminho.replace(/:[a-zA-Z]+/g, crypto.randomUUID());
      const r = await request(servidor(app))[metodo.toLowerCase() as 'get'](url)
        .set('Authorization', `Bearer ${token}`).send({});
      if (r.status !== 403) liberadas.push(rota);
    }
    expect(new Set(liberadas)).toEqual(PERMITE_AAL1);
  });

  it('toda rota não pública responde 401 sem sessão', async () => {
    const express = (app as NestExpressApplication).getHttpAdapter().getInstance() as { router: { stack: Camada[] } };
    // Ignora o curinga {/*splat} que o Nest registra para os middlewares (não é rota de controller).
    const rotas = express.router.stack.flatMap((c) =>
      c.route && !c.route.path.includes('{')
        ? Object.keys(c.route.methods).map((m) => `${m.toUpperCase()} ${c.route?.path ?? ''}`)
        : []);
    expect(rotas.length).toBeGreaterThan(5);
    const publicas: string[] = [];
    for (const rota of rotas) {
      const [metodo = 'GET', caminho = '/'] = rota.split(' ');
      const url = caminho.replace(/:[a-zA-Z]+/g, crypto.randomUUID());
      const r = await request(servidor(app))[metodo.toLowerCase() as 'get'](url).send({});
      if (r.status !== 401) publicas.push(rota);
    }
    expect(new Set(publicas)).toEqual(PUBLICAS);
  });
});
