import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { carregarConfig } from '../src/config.js';
import { KEK_TESTE } from './apoio.js';

async function subir(databaseUrl: string): Promise<INestApplication> {
  const config = carregarConfig({ DATABASE_URL: databaseUrl, LOG_LEVEL: 'fatal', VV_ENV: 'dev', VV_KEK: KEK_TESTE });
  const modulo = await Test.createTestingModule({ imports: [AppModule.com(config)] }).compile();
  const app = modulo.createNestApplication({ logger: false, bodyParser: false });
  await app.init();
  return app;
}

describe('GET /health', () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('Defina DATABASE_URL_TEST (papel vv_api) para os e2e.');

  it('responde ok quando alcança o banco como vv_api', async () => {
    const app = await subir(url);
    await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200, { status: 'ok', banco: 'ok', ambiente: 'dev' });
    await app.close();
  });

  it('responde 503 sem detalhe de erro quando o banco está fora', async () => {
    const app = await subir('postgres://vv_api:x@127.0.0.1:1/vv');
    const res = await request(app.getHttpServer() as Server).get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'erro', banco: 'indisponivel' });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    await app.close();
  });
});
