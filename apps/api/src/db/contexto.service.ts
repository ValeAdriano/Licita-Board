import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { DB, type Database } from './db.module.js';

export interface DadosRequisicao {
  token: string;
  ip: string | null;
  userAgent: string | null;
}

// Toda consulta feita em nome de um usuário passa por aqui (ADR-013): a transação recebe o token da
// sessão e o banco confere a sessão em core.sessoes; a RLS usa esse contexto. Sessão inválida = 401.
@Injectable()
export class ContextoService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async comContexto<T>(req: DadosRequisicao, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(async (tx) => {
        await sql`select core.definir_contexto(${req.token})`.execute(tx);
        await sql`select core.definir_requisicao(${req.ip}::inet, ${req.userAgent})`.execute(tx);
        return fn(tx);
      });
    } catch (e) {
      if (codigoPg(e) === '28000') throw new UnauthorizedException();
      throw e;
    }
  }

  // Endpoints públicos (login, recuperação): transação sem usuário; só funções do banco que não
  // dependem de contexto.
  async semSessao<T>(fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(fn);
    } catch (e) {
      // Mesmo 401 de senha errada (ex.: conta bloqueada entre as duas etapas do login).
      if (codigoPg(e) === '28000') throw new UnauthorizedException('E-mail ou senha incorretos.');
      throw e;
    }
  }
}

export function codigoPg(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}
