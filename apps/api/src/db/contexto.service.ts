import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { DB, type Database } from './db.module.js';

export interface DadosRequisicao {
  token: string;
  ip: string | null;
  userAgent: string | null;
  // Requisição de segundo plano (polling do app): confere a sessão, mas não renova a inatividade.
  fundo?: boolean;
}

// Toda consulta feita em nome de um usuário passa por aqui (ADR-013): a transação recebe o token da
// sessão e o banco confere a sessão em core.sessoes; a RLS usa esse contexto. Sessão inválida = 401.
@Injectable()
export class ContextoService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async comContexto<T>(req: DadosRequisicao, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(async (tx) => {
        await sql`select core.definir_contexto(${req.token}::text, ${!req.fundo}::boolean)`.execute(tx);
        await sql`select core.definir_requisicao(${req.ip}::inet, ${req.userAgent})`.execute(tx);
        return fn(tx);
      });
    } catch (e) {
      if (codigoPg(e) === '28000') throw new UnauthorizedException();
      // Regra do banco recusou por falta de MFA recente/permissão (ex.: trocar autenticador).
      if (codigoPg(e) === '42501') throw new ForbiddenException();
      // Limite de uso imposto pelo banco (ex.: cadastros de autenticador, convites por dia).
      if (codigoPg(e) === '54000') throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
      // Regras de negócio: só a mensagem de um raise nosso chega ao cliente. Erro de constraint ou
      // índice vira resposta genérica (nome de tabela/constraint não vira oráculo entre empresas).
      if (['22023', '23514', '23505', '23503'].includes(codigoPg(e) ?? '')) {
        if (deRaise(e)) throw new BadRequestException(mensagemPg(e));
        if (codigoPg(e) === '23505') throw new ConflictException('Registro já existe.');
        throw new BadRequestException('Dados inválidos.');
      }
      if (codigoPg(e) === 'P0002') throw new NotFoundException();
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

// O erro veio de um raise exception de função nossa (não de constraint/índice).
export function deRaise(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'routine' in e && e.routine === 'exec_stmt_raise';
}

// Mensagem do raise do banco (nunca o DETAIL, que pode trazer a linha com dado pessoal).
export function mensagemPg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : 'Operação recusada.';
}

export function codigoPg(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}
