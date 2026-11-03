import argon2 from 'argon2';

// Argon2id com os parâmetros mínimos da OWASP (ADR-012). Subir os parâmetros não invalida hashes
// antigos: argon2.needsRehash diz quando regravar no próximo login.
const PARAMETROS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const SENHA_MIN = 12;
export const SENHA_MAX = 128;

// Argon2 custa ~19 MiB e uma thread do libuv por chamada: no máximo 4 ao mesmo tempo; acima disso,
// 503 rápido em vez de fila (indisponibilidade por custo de hash, T7.1).
const MAX_SIMULTANEOS = 4;
let emUso = 0;

export class Argon2Ocupado extends Error {}

async function comVaga<T>(fn: () => Promise<T>): Promise<T> {
  if (emUso >= MAX_SIMULTANEOS) throw new Argon2Ocupado();
  emUso++;
  try {
    return await fn();
  } finally {
    emUso--;
  }
}

export function hashSenha(senha: string): Promise<string> {
  return comVaga(() => argon2.hash(senha, PARAMETROS));
}

// Hash de uma senha aleatória: o login de e-mail inexistente gasta o mesmo tempo que o de um
// existente (sem enumeração de usuários pelo tempo de resposta).
let hashFalso: Promise<string> | undefined;
export function obterHashFalso(): Promise<string> {
  hashFalso ??= argon2.hash(crypto.randomUUID(), PARAMETROS);
  return hashFalso;
}

export async function conferirSenha(hash: string | null | undefined, senha: string): Promise<boolean> {
  const alvo = hash ?? (await obterHashFalso());
  try {
    const ok = await comVaga(() => argon2.verify(alvo, senha));
    return ok && hash != null;
  } catch (e) {
    if (e instanceof Argon2Ocupado) throw e;
    return false;
  }
}

export function precisaRehash(hash: string): boolean {
  return argon2.needsRehash(hash, PARAMETROS);
}

// Política mínima (Prompt 1.4). A consulta a senhas vazadas (HIBP, decisão 2) entra no PR 3b.
export function problemaNaSenha(senha: string): string | null {
  if (senha.length < SENHA_MIN) return `A senha precisa de pelo menos ${String(SENHA_MIN)} caracteres.`;
  if (senha.length > SENHA_MAX) return `A senha pode ter no máximo ${String(SENHA_MAX)} caracteres.`;
  return null;
}
