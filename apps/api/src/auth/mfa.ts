import { randomBytes } from 'node:crypto';

// Base32 (RFC 4648, sem padding): formato dos apps autenticadores e dos códigos de recuperação.
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO.charAt((valor << (5 - bits)) & 31);
  return saida;
}

// Segredo TOTP de 160 bits (RFC 4226 recomenda ≥ 128). Mostrado uma vez, no cadastro.
export function novoSegredoTotp(): Buffer {
  return randomBytes(20);
}

export function uriOtpAuth(segredo: Buffer, conta: string): string {
  const emissor = 'VV Licitações';
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  const params = new URLSearchParams({
    secret: base32(segredo),
    issuer: emissor,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

// 10 códigos de recuperação de 20 caracteres base32 (100 bits cada), mostrados uma vez.
export function novosCodigosRecuperacao(): string[] {
  return Array.from({ length: 10 }, () => base32(randomBytes(13)).slice(0, 20));
}

// Código de recuperação como o usuário digita (grupos, espaços, minúsculas) → forma guardada.
export function normalizarCodigoRecuperacao(c: string): string {
  return c.replace(/[\s-]/g, '').toUpperCase();
}
