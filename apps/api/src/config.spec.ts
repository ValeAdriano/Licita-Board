import { describe, expect, it } from 'vitest';
import { carregarConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://vv_api:segredo-de-teste@localhost:5432/vv' };

describe('carregarConfig', () => {
  it('aplica os padrões de desenvolvimento', () => {
    expect(carregarConfig(base)).toMatchObject({
      NODE_ENV: 'development',
      VV_ENV: 'dev',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('recusa DATABASE_URL de outro papel (ADR-013)', () => {
    for (const papel of ['vv_worker', 'vv_owner', 'postgres']) {
      expect(() =>
        carregarConfig({ DATABASE_URL: `postgres://${papel}:x@localhost:5432/vv` }),
      ).toThrow('DATABASE_URL precisa usar o papel vv_api');
    }
  });

  it('recusa DATABASE_URL ausente ou que não é Postgres', () => {
    expect(() => carregarConfig({})).toThrow('DATABASE_URL');
    expect(() => carregarConfig({ DATABASE_URL: 'mysql://vv_api:x@localhost/vv' })).toThrow(
      'DATABASE_URL',
    );
  });

  it('não vaza a senha na mensagem de erro', () => {
    let mensagem = '';
    try {
      carregarConfig({ ...base, DATABASE_URL: 'postgres://vv_worker:senha-secreta@x/vv' });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toContain('DATABASE_URL');
    expect(mensagem).not.toContain('senha-secreta');
  });

  it('lê CORS_ORIGINS como lista e recusa origem que não é http(s)', () => {
    expect(carregarConfig(base).CORS_ORIGINS).toEqual(['http://localhost:8081']);
    expect(
      carregarConfig({ ...base, CORS_ORIGINS: 'https://app.vv.test, http://localhost:8081' })
        .CORS_ORIGINS,
    ).toEqual(['https://app.vv.test', 'http://localhost:8081']);
    expect(() => carregarConfig({ ...base, CORS_ORIGINS: 'javascript:alert(1)' })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it('recusa VV_ENV e PORT inválidos', () => {
    expect(() => carregarConfig({ ...base, VV_ENV: 'producao' })).toThrow('VV_ENV');
    expect(() => carregarConfig({ ...base, PORT: '70000' })).toThrow('PORT');
  });
});
