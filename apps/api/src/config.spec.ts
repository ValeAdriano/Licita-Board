import { describe, expect, it } from 'vitest';
import { carregarConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://vv_api:segredo-de-teste@localhost:5432/vv',
  VV_KEK: 'kek-de-teste-nao-usar-em-producao-0123456789',
};

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
        carregarConfig({ ...base, DATABASE_URL: `postgres://${papel}:x@localhost:5432/vv` }),
      ).toThrow('DATABASE_URL precisa usar o papel vv_api');
    }
  });

  it('recusa DATABASE_URL ausente ou que não é Postgres', () => {
    expect(() => carregarConfig({})).toThrow('DATABASE_URL');
    expect(() => carregarConfig({ ...base, DATABASE_URL: 'mysql://vv_api:x@localhost/vv' })).toThrow(
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
    expect(carregarConfig(base).CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(
      carregarConfig({ ...base, CORS_ORIGINS: 'https://app.vv.test, http://localhost:5173' })
        .CORS_ORIGINS,
    ).toEqual(['https://app.vv.test', 'http://localhost:5173']);
    expect(() => carregarConfig({ ...base, CORS_ORIGINS: 'javascript:alert(1)' })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it('TRUST_PROXY só aceita false, loopback ou IP/CIDR', () => {
    expect(carregarConfig({ ...base, TRUST_PROXY: '172.20.0.2/32' }).TRUST_PROXY).toBe('172.20.0.2/32');
    for (const v of ['true', '1', 'qualquer']) {
      expect(() => carregarConfig({ ...base, TRUST_PROXY: v })).toThrow('TRUST_PROXY');
    }
  });

  it('fora de dev, CORS_ORIGINS https e TRUST_PROXY explícito', () => {
    for (const env of ['prod', 'homolog']) {
      expect(() => carregarConfig({ ...base, VV_ENV: env, TRUST_PROXY: '172.20.0.2' })).toThrow('CORS_ORIGINS');
      expect(() => carregarConfig({ ...base, VV_ENV: env, CORS_ORIGINS: 'https://app.vv.test' })).toThrow('TRUST_PROXY');
      expect(() => carregarConfig({ ...base, VV_ENV: env, CORS_ORIGINS: 'https://app.vv.test', TRUST_PROXY: '172.20.0.2' }))
        .toThrow('TURNSTILE_SECRET');
      expect(carregarConfig({
        ...base, VV_ENV: env, CORS_ORIGINS: 'https://app.vv.test', TRUST_PROXY: '172.20.0.2', TURNSTILE_SECRET: 's',
      }).CORS_ORIGINS).toEqual(['https://app.vv.test']);
    }
  });

  it('TRUST_PROXY recusa máscara inválida', () => {
    expect(() => carregarConfig({ ...base, TRUST_PROXY: '10.0.0.0/99' })).toThrow('TRUST_PROXY');
    expect(carregarConfig({ ...base, TRUST_PROXY: '2001:db8::/64' }).TRUST_PROXY).toBe('2001:db8::/64');
  });

  it('exige VV_KEK de pelo menos 32 caracteres', () => {
    expect(() => carregarConfig({ DATABASE_URL: base.DATABASE_URL })).toThrow('VV_KEK');
    expect(() => carregarConfig({ ...base, VV_KEK: 'curta' })).toThrow('VV_KEK');
  });

  it('recusa VV_ENV e PORT inválidos', () => {
    expect(() => carregarConfig({ ...base, VV_ENV: 'producao' })).toThrow('VV_ENV');
    expect(() => carregarConfig({ ...base, PORT: '70000' })).toThrow('PORT');
  });
});
