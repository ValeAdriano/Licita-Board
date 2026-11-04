import { describe, expect, it } from 'vitest';
import { conferirSenha, hashSenha, precisaRehash, problemaNaSenha } from './senha.js';

describe('senha', () => {
  it('hash Argon2id com os parâmetros da ADR-012 (m=19 MiB, t=2, p=1), que confere e não precisa de rehash', async () => {
    const hash = await hashSenha('uma-senha-longa-qualquer');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await conferirSenha(hash, 'uma-senha-longa-qualquer')).toBe(true);
    expect(await conferirSenha(hash, 'outra-senha-longa-qualquer')).toBe(false);
    expect(precisaRehash(hash)).toBe(false);
  });

  it('conta inexistente nunca confere, mesmo com o hash falso', async () => {
    expect(await conferirSenha(null, 'uma-senha-longa-qualquer')).toBe(false);
  });

  it('mínimo de 12 e máximo de 128 caracteres', () => {
    expect(problemaNaSenha('a'.repeat(11))).toMatch(/pelo menos 12/);
    expect(problemaNaSenha('a'.repeat(12))).toBeNull();
    expect(problemaNaSenha('a'.repeat(128))).toBeNull();
    expect(problemaNaSenha('a'.repeat(129))).toMatch(/no máximo 128/);
  });
});
