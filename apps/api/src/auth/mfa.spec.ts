import { describe, expect, it } from 'vitest';
import { base32, normalizarCodigoRecuperacao, novoSegredoTotp, novosCodigosRecuperacao, uriOtpAuth } from './mfa.js';

describe('mfa', () => {
  it('base32 segue a RFC 4648 (sem padding)', () => {
    const b = (s: string) => base32(Buffer.from(s));
    expect(b('')).toBe('');
    expect(b('f')).toBe('MY');
    expect(b('fo')).toBe('MZXQ');
    expect(b('foo')).toBe('MZXW6');
    expect(b('foob')).toBe('MZXW6YQ');
    expect(b('fooba')).toBe('MZXW6YTB');
    expect(b('foobar')).toBe('MZXW6YTBOI');
  });

  it('segredo de 160 bits e URI otpauth com emissor e parâmetros padrão', () => {
    const s = novoSegredoTotp();
    expect(s).toHaveLength(20);
    const uri = new URL(uriOtpAuth(s, 'ana@teste.local'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(base32(s));
    expect(uri.searchParams.get('issuer')).toBe('VV Licitações');
    expect(uri.searchParams.get('digits')).toBe('6');
  });

  it('normaliza o código digitado com grupos e minúsculas', () => {
    expect(normalizarCodigoRecuperacao('abcde-fghij 23456-7abcd')).toBe('ABCDEFGHIJ234567ABCD');
  });

  it('10 códigos distintos de 20 caracteres base32', () => {
    const c = novosCodigosRecuperacao();
    expect(c).toHaveLength(10);
    expect(new Set(c).size).toBe(10);
    for (const x of c) expect(x).toMatch(/^[A-Z2-7]{20}$/);
  });
});
