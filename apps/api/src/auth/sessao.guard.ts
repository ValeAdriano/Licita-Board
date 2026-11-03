import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'kysely';
import { ContextoService } from '../db/contexto.service.js';
import { COOKIE_CSRF, HEADER_CSRF, type RequisicaoVV, dadosDe, lerToken } from './requisicao.js';

const PUBLICO = 'vv:publico';
// Rota sem sessão (login, recuperação, health). Todo o resto exige sessão viva por padrão.
export const Publico = () => SetMetadata(PUBLICO, true);

const PERMITE_AAL1 = 'vv:permite-aal1';
// Rota liberada a quem ainda não passou do segundo fator (consultar a sessão, sair, cadastrar ou
// verificar o MFA). Para quem tem ou precisa de MFA, todo o resto exige aal2 (T5.8).
export const PermiteAal1 = () => SetMetadata(PERMITE_AAL1, true);

const PERMISSAO = 'vv:permissao';
interface RequisitoPermissao {
  modulo: string;
  acao: string;
  param: string;
}
// Primeira camada do isolamento (ADR-013): a empresa vem do parâmetro da rota e o guard confere
// core.has_permission no banco antes do handler. Sem permissão (ou empresa de outro cliente) = 404,
// sem revelar se a empresa existe. A RLS confere de novo em cada consulta (segunda camada).
export const Permissao = (modulo: string, acao: string, param = 'empresa') =>
  SetMetadata(PERMISSAO, { modulo, acao, param } satisfies RequisitoPermissao);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Guard global (ADR-012/013): sessão viva conferida no banco e, para sessão por cookie, CSRF por
// double submit em todo método que altera estado.
@Injectable()
export class SessaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexto: ContextoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Só no método: @Publico() numa classe não abre o controller inteiro.
    const publico = this.reflector.get<boolean | undefined>(PUBLICO, ctx.getHandler());
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest<RequisicaoVV>();
    const lido = lerToken(req);
    if (!lido) throw new UnauthorizedException();

    if (lido.origem === 'cookie' && !METODOS_SEGUROS.has(req.method)) {
      const cookies = req.cookies as Record<string, string | undefined>;
      const cookie = cookies[COOKIE_CSRF];
      const header = req.headers[HEADER_CSRF];
      if (!cookie || typeof header !== 'string' || !iguais(cookie, header)) {
        throw new ForbiddenException('CSRF');
      }
    }

    const requisito = this.reflector.getAllAndOverride<RequisitoPermissao | undefined>(PERMISSAO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const params = req.params as Record<string, string | undefined>;
    const empresa = requisito ? params[requisito.param] : undefined;
    if (requisito && (!empresa || !UUID.test(empresa))) throw new NotFoundException();

    const sessao = await this.contexto.comContexto(dadosDe(req, lido.token), async (tx) => {
      const r = await sql<{ usuario: string; aal: 'aal1' | 'aal2'; precisa_mfa: boolean; permitido: boolean }>`
        select core.usuario_atual() as usuario, core.aal_atual() as aal,
               core.tem_mfa() or core.mfa_obrigatorio() as precisa_mfa,
               ${requisito ? sql`core.has_permission(${empresa}::uuid, ${requisito.modulo}, ${requisito.acao})` : sql`true`} as permitido`
        .execute(tx);
      return r.rows[0];
    });
    if (!sessao) throw new UnauthorizedException();
    if (sessao.aal !== 'aal2' && sessao.precisa_mfa && !this.reflector.get<boolean | undefined>(PERMITE_AAL1, ctx.getHandler())) {
      throw new ForbiddenException('MFA');
    }
    if (!sessao.permitido) throw new NotFoundException();
    req.sessao = { token: lido.token, origem: lido.origem, usuarioId: sessao.usuario, aal: sessao.aal };
    return true;
  }
}
