import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { hashSenha } from '../src/auth/senha.js';
import { carregarConfig } from '../src/config.js';
import { configurarApp } from '../src/configurar-app.js';

// e2e com Postgres real: DATABASE_URL_TEST (vv_api) roda a API; DATABASE_URL_ADMIN_TEST
// (superusuário do banco descartável) só prepara dados fictícios.
// Mesma KEK fictícia registrada em db/tests/000_helpers (tests.kek()).
export const KEK_TESTE = 'kek-de-teste-nao-usar-em-producao-0123456789';

export function urls(): { api: string; admin: string } {
  const api = process.env.DATABASE_URL_TEST;
  const admin = process.env.DATABASE_URL_ADMIN_TEST;
  if (!api || !admin) throw new Error('Defina DATABASE_URL_TEST (vv_api) e DATABASE_URL_ADMIN_TEST.');
  return { api, admin };
}

export async function subirApp(extra: Record<string, string> = {}): Promise<INestApplication> {
  const config = carregarConfig({
    DATABASE_URL: urls().api, LOG_LEVEL: 'fatal', TRUST_PROXY: 'loopback', LOGIN_ATRASO_MS: '0', VV_KEK: KEK_TESTE, ...extra,
  });
  const modulo = await Test.createTestingModule({ imports: [AppModule.com(config)] }).compile();
  const app = modulo.createNestApplication({ logger: false, bodyParser: false });
  configurarApp(app, config);
  await app.init();
  return app;
}

export function servidor(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

export const admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN_TEST, max: 2 });

export const SENHA = 'senha-de-teste-bem-longa';

// Usuário fictício com e-mail único por execução. Opcional: vínculo de perfil interno.
export async function criarUsuario(prefixo: string, opcoes: { interno?: boolean } = {}): Promise<string> {
  const email = `${prefixo}-${crypto.randomUUID().slice(0, 8)}@teste.local`;
  const hash = await hashSenha(SENHA);
  const r = await admin.query<{ id: string }>(
    'insert into core.usuarios (email, nome, senha_hash) values ($1, $2, $3) returning id', [email, prefixo, hash]);
  if (opcoes.interno) {
    const cnpj = await admin.query<{ id: string }>(
      `insert into core.empresas (razao_social, cnpj) values ($1, $2) returning id`,
      [`Empresa ${email}`, cnpjFicticio()]);
    await admin.query(`insert into core.vinculos (usuario_id, empresa_id, papel) values ($1, $2, 'OPERADOR')`,
      [r.rows[0]?.id, cnpj.rows[0]?.id]);
  }
  return email;
}

// CNPJ numérico fictício com DV válido.
function cnpjFicticio(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const dv = (pesos: number[], n: number[]) => {
    const r = n.reduce((s, d, i) => s + d * (pesos[i] ?? 0), 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], base);
  const d2 = dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [...base, d1]);
  return [...base, d1, d2].join('');
}

export function cookies(res: { headers: Record<string, unknown> }): string[] {
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? (c as string[]) : [];
}

export function valorCookie(lista: string[], nome: string): string | undefined {
  const c = lista.find((x) => x.startsWith(`${nome}=`));
  return c?.split(';')[0]?.slice(nome.length + 1);
}

// IP fictício (faixas de documentação) por teste: o limite de 10 tentativas/min por IP é real.
let ultimoIp = 0;
export function ipNovo(): string {
  ultimoIp++;
  return `198.51.${String(100 + Math.floor(ultimoIp / 250))}.${String(1 + (ultimoIp % 250))}`;
}

// TOTP (RFC 6238) calculado como um app autenticador, a partir da URI otpauth do cadastro.
export function totpDaUri(uri: string, deslocamento = 0): string {
  const segredo = new URL(uri).searchParams.get('secret') ?? '';
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredo) bits += alfabeto.indexOf(c).toString(2).padStart(5, '0');
  const chave = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const passo = Math.floor(Date.now() / 1000 / 30) + deslocamento;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', chave).update(msg).digest();
  const o = (h[19] ?? 0) & 15;
  const bin = (((h[o] ?? 0) & 127) << 24) | ((h[o + 1] ?? 0) << 16) | ((h[o + 2] ?? 0) << 8) | (h[o + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, '0');
}
