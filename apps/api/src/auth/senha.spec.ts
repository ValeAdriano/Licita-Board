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

  it('de 8 a 128 caracteres, com ao menos um especial', () => {
    expect(problemaNaSenha('a!bcdef')).toMatch(/pelo menos 8/);
    expect(problemaNaSenha('abcdefgh')).toMatch(/caractere especial/);
    expect(problemaNaSenha('abcd1234')).toMatch(/caractere especial/);
    expect(problemaNaSenha('abcdef!h')).toBeNull();
    expect(problemaNaSenha('abc def1')).toBeNull(); // espaço conta como especial
    expect(problemaNaSenha('senha-curta')).toBeNull();
    expect(problemaNaSenha(`${'a'.repeat(127)}!`)).toBeNull();
    expect(problemaNaSenha(`${'a'.repeat(128)}!`)).toMatch(/no máximo 128/);
  });
});
