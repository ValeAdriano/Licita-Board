import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

// Cifra de campo em envelope (ADR-017; spec fase-02 §3.1, RF-02.14).
//
// Cada valor sensível (PIX, conta, CPF) é cifrado com uma DEK aleatória (AES-256-GCM); a DEK é
// cifrada pela KEK (também AES-256-GCM). O banco guarda só o envelope em jsonb:
//   { "v": 1, "dek": b64(ivDek[12] | dekCifrada[32] | tag[16]), "iv": b64(iv[12]), "ct": b64(cifrado | tag[16]) }
// `v` é a versão da KEK. O CONTEXTO (tabela, coluna e empresa do registro) entra como dado
// autenticado (AAD) nos dois passos: um envelope copiado para outra linha ou coluna não decifra.
//
// A KEK e a chave do HMAC saem de VV_KEK por HKDF-SHA256 (salt vazio), com `info` diferente para cada
// uso, então a mesma senha-mestra nunca é usada direto nem para duas coisas. Risco aceito até existir
// KMS: quem tem a VV_KEK tem as duas chaves (ADR-017). O formato é o mesmo em Python (worker): os
// vetores de teste estão em docs/referencia/cifra-campo-vetores.json e o worker os confere.
const VERSAO = 1;
const INFO_KEK = 'vv-campo-kek-v1';
const INFO_HMAC = 'vv-campo-hmac-v1';

export interface Envelope {
  v: number;
  dek: string;
  iv: string;
  ct: string;
}

// Aleatoriedade injetável só para os vetores de teste; em produção sempre `randomBytes`.
export interface Aleatorio {
  dek: Buffer;
  iv: Buffer;
  ivDek: Buffer;
}

function derivar(segredo: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.alloc(0), info, 32));
}

function selar(texto: Buffer, chave: Buffer, iv: Buffer, aad: string): Buffer {
  const c = createCipheriv('aes-256-gcm', chave, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([c.update(texto), c.final(), c.getAuthTag()]);
}

function abrir(selado: Buffer, chave: Buffer, iv: Buffer, aad: string): Buffer {
  if (selado.length < 16) throw new Error('Falha ao decifrar.');
  const d = createDecipheriv('aes-256-gcm', chave, iv);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(selado.subarray(selado.length - 16));
  return Buffer.concat([d.update(selado.subarray(0, selado.length - 16)), d.final()]);
}

export class CifraCampo {
  private readonly kek: Buffer;
  private readonly chaveHmac: Buffer;

  constructor(segredo: string) {
    if (segredo.length < 32) throw new Error('VV_KEK precisa de pelo menos 32 caracteres.');
    this.kek = derivar(segredo, INFO_KEK);
    this.chaveHmac = derivar(segredo, INFO_HMAC);
  }

  cifrar(texto: string, contexto: string, aleatorio?: Aleatorio): Envelope {
    const a = aleatorio ?? { dek: randomBytes(32), iv: randomBytes(12), ivDek: randomBytes(12) };
    const ct = selar(Buffer.from(texto, 'utf8'), a.dek, a.iv, `dado|${contexto}`);
    const dekCifrada = Buffer.concat([a.ivDek, selar(a.dek, this.kek, a.ivDek, `dek|${contexto}`)]);
    return { v: VERSAO, dek: dekCifrada.toString('base64'), iv: a.iv.toString('base64'), ct: ct.toString('base64') };
  }

  // Qualquer problema (envelope malformado, contexto errado, dado adulterado, outra KEK) vira o mesmo erro.
  decifrar(envelope: unknown, contexto: string): string {
    try {
      const e = envelope as Partial<Envelope> | null;
      if (typeof e !== 'object' || e === null || e.v !== VERSAO) throw new Error('versão');
      const dekCifrada = Buffer.from(e.dek ?? '', 'base64');
      if (dekCifrada.length !== 12 + 32 + 16) throw new Error('dek');
      const dek = abrir(dekCifrada.subarray(12), this.kek, dekCifrada.subarray(0, 12), `dek|${contexto}`);
      const iv = Buffer.from(e.iv ?? '', 'base64');
      if (iv.length !== 12) throw new Error('iv');
      return abrir(Buffer.from(e.ct ?? '', 'base64'), dek, iv, `dado|${contexto}`).toString('utf8');
    } catch {
      throw new Error('Falha ao decifrar.');
    }
  }

  // Marca para detectar duplicidade sem decifrar (CPF, chave PIX). O `dominio` separa os usos e a
  // empresa entra no valor: o mesmo CPF em duas empresas gera marcas diferentes.
  marca(valorNormalizado: string, dominio: string): string {
    return createHmac('sha256', this.chaveHmac).update(`${dominio}\0${valorNormalizado}`, 'utf8').digest('hex');
  }
}

// Máscara para mostrar: só os últimos caracteres, o resto vira bolinhas (nunca devolve o valor inteiro).
export function mascarar(valor: string, visiveis = 4): string {
  const v = valor.trim();
  if (v.length <= visiveis) return '•'.repeat(Math.max(v.length, 4));
  return `${'•'.repeat(Math.min(v.length - visiveis, 8))}${v.slice(-visiveis)}`;
}
