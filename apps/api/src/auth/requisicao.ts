import { isIP } from 'node:net';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { DadosRequisicao } from '../db/contexto.service.js';

export const COOKIE_SESSAO = '__Host-sessao';
export const COOKIE_CSRF = '__Host-csrf';
export const HEADER_CSRF = 'x-csrf-token';
// O app marca a consulta automática (polling) com este cabeçalho: ela não conta como uso (T5.17).
export const HEADER_FUNDO = 'x-vv-fundo';
// 403 quando a operação exige MFA recente (5 min): o app pede o código do autenticador e repete.
export const MSG_MFA_RECENTE = 'Confirme o código do autenticador antes de continuar.';

export interface Sessao {
  token: string;
  origem: 'cookie' | 'bearer';
  usuarioId: string;
  aal: 'aal1' | 'aal2';
}

export type RequisicaoVV = Request & { sessao?: Sessao };

export function lerToken(req: Request): { token: string; origem: Sessao['origem'] } | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    return token ? { token, origem: 'bearer' } : null;
  }
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const token = cookies?.[COOKIE_SESSAO];
  return token ? { token, origem: 'cookie' } : null;
}

// IP como indício (auditoria, tentativas): req.ip só confia no X-Forwarded-For do proxy configurado
// em TRUST_PROXY (o Caddy local). Valor inválido vira nulo em vez de derrubar a requisição.
export function ipDe(req: Request): string | null {
  const ip = req.ip?.replace(/^::ffff:/, '') ?? '';
  return isIP(ip) ? ip : null;
}

export function dadosDe(req: Request, token: string): DadosRequisicao {
  return {
    token,
    ip: ipDe(req),
    userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
    // Só leitura pode ser de fundo: ação da pessoa (POST/PUT/DELETE) sempre conta como uso.
    fundo: req.method === 'GET' && req.headers[HEADER_FUNDO] === '1',
  };
}

export const DOZE_HORAS = 12 * 60 * 60 * 1000;
export const opcoesCookie = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;

export function validar<T>(schema: z.ZodType<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo);
  if (!r.success) throw new BadRequestException('Dados inválidos.');
  return r.data;
}

export function sessaoDe(req: RequisicaoVV): Sessao {
  if (!req.sessao) throw new UnauthorizedException();
  return req.sessao;
}

// Depois de rotacionar o token no banco (troca de senha, elevação a aal2): web recebe o cookie novo;
// nativo recebe o token no corpo para regravar no SecureStore.
export function emitirTokenRotacionado(res: Response, s: Sessao, token: string): { token?: string } {
  if (s.origem === 'cookie') {
    res.cookie(COOKIE_SESSAO, token, { ...opcoesCookie, maxAge: DOZE_HORAS });
    return {};
  }
  return { token };
}
