import {
  BadRequestException,
  Body,
  ForbiddenException,
  Inject,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Config } from '../config.js';
import { ContextoService } from '../db/contexto.service.js';
import { CONFIG } from '../tokens.js';
import { AuthService, LimitePorIp, chaveDeIp, novoToken } from './auth.service.js';
import { senhaVazada } from './protecoes.js';
import {
  COOKIE_CSRF,
  COOKIE_SESSAO,
  DOZE_HORAS,
  type RequisicaoVV,
  dadosDe,
  emitirTokenRotacionado,
  ipDe,
  MSG_MFA_RECENTE,
  opcoesCookie,
  sessaoDe,
  validar,
} from './requisicao.js';
import { Argon2Ocupado, conferirSenha, hashSenha, problemaNaSenha } from './senha.js';
import { PermiteAal1, Publico } from './sessao.guard.js';

const loginSchema = z.object({
  email: z.email().max(254),
  senha: z.string().min(1).max(1024),
  plataforma: z.enum(['web', 'ios', 'android']),
  captcha: z.string().max(4096).optional(),
});
const recuperarSchema = z.object({ email: z.email().max(254), captcha: z.string().max(4096).optional() }).strict();
const redefinirSchema = z.object({ token: z.string().min(43).max(128), senha: z.string() }).strict();
const MSG_VAZADA = 'Esta senha aparece em vazamentos conhecidos. Escolha outra.';
const logHibp = new Logger('hibp');
// HIBP fora do ar: a senha passa só pela lista local; fica registrado (sem senha nem prefixo).
const avisarHibp = () => {
  logHibp.warn('hibp_indisponivel');
};
const trocaSenhaSchema = z.object({ atual: z.string().min(1).max(1024), nova: z.string() });
const sairTodasSchema = z.object({ manterAtual: z.boolean().default(true) });


@Controller('auth')
export class AuthController {
  private readonly limiteRecuperacao = new LimitePorIp();

  constructor(
    private readonly auth: AuthService,
    private readonly contexto: ContextoService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  // Login CSRF: o web só aceita login vindo do próprio app (Origin listado; navegação de outro site
  // não grava sessão de outra conta no navegador da vítima). Nativo não manda Origin.
  private conferirOrigem(req: RequisicaoVV): void {
    const origem = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || (origem !== undefined && !this.config.CORS_ORIGINS.includes(origem))) {
      throw new ForbiddenException('Origem');
    }
  }

  // Web: token só em cookie HttpOnly (nunca no corpo). Nativo: token no corpo, para o SecureStore.
  // Todo login gera token novo (sem fixação de sessão); cookie anterior é ignorado.
  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    const { email, senha, plataforma, captcha } = validar(loginSchema, corpo);
    if (plataforma === 'web') this.conferirOrigem(req);
    const r = await this.auth.login(email, senha, plataforma, ipDe(req), req.headers['user-agent'] ?? null, captcha);
    if (plataforma === 'web') {
      res.cookie(COOKIE_SESSAO, r.token, { ...opcoesCookie, maxAge: DOZE_HORAS });
      res.cookie(COOKIE_CSRF, r.csrf, { ...opcoesCookie, maxAge: DOZE_HORAS });
      return { mfa: r.mfa, csrf: r.csrf };
    }
    return { mfa: r.mfa, token: r.token };
  }

  // Recuperação (Prompt 1.4): resposta sempre igual, exista ou não a conta. O e-mail com o link sai
  // pelo worker (o token nasce lá; a API nunca vê o token). CAPTCHA a partir do 3º pedido do IP.
  @Publico()
  @Post('recuperar')
  @HttpCode(202)
  async recuperar(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const { email, captcha } = validar(recuperarSchema, corpo);
    const ip = ipDe(req);
    if (!this.limiteRecuperacao.permitir(ip)) {
      throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // CAPTCHA a partir do 3º pedido do mesmo IP (IPv6 por /64) em 15 min.
    const chave = `recuperar:${chaveDeIp(ip)}`;
    this.auth.registrarFalha(chave);
    await this.auth.exigirCaptcha([chave], captcha, ip);
    await this.contexto.semSessao((tx) => sql`select core.solicitar_recuperacao(${email}, ${this.config.VV_KEK})`.execute(tx));
    return {};
  }

  // Nova senha pelo link do e-mail: política mínima + senha vazada; redefinir encerra as sessões e
  // prova a posse do e-mail (liga convites pendentes).
  @Publico()
  @Post('redefinir')
  @HttpCode(204)
  async redefinir(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const { token, senha } = validar(redefinirSchema, corpo);
    if (!this.limiteRecuperacao.permitir(ipDe(req))) {
      throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const problema = problemaNaSenha(senha);
    if (problema) throw new BadRequestException(problema);
    if (await senhaVazada(senha, this.config.HIBP_URL, fetch, avisarHibp)) throw new BadRequestException(MSG_VAZADA);
    let hash: string;
    try {
      hash = await hashSenha(senha);
    } catch (e) {
      if (e instanceof Argon2Ocupado) throw new ServiceUnavailableException();
      throw e;
    }
    const ok = await this.contexto.semSessao(async (tx) => {
      const r = await sql<{ ok: boolean }>`select core.redefinir_senha(${token}, ${hash}, ${this.config.VV_KEK}) as ok`.execute(tx);
      return r.rows[0]?.ok === true;
    });
    if (!ok) throw new BadRequestException('Link inválido ou expirado. Peça um novo.');
  }

  @PermiteAal1()
  @Get('sessao')
  async sessao(@Req() req: RequisicaoVV) {
    const s = sessaoDe(req);
    const mfa = await this.auth.estadoMfa(dadosDe(req, s.token));
    const cookies = req.cookies as Record<string, string | undefined>;
    return { usuarioId: s.usuarioId, aal: s.aal, mfa, csrf: s.origem === 'cookie' ? cookies[COOKIE_CSRF] : undefined };
  }

  @PermiteAal1()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response) {
    const s = sessaoDe(req);
    await this.contexto.comContexto(dadosDe(req, s.token), (tx) => sql`select core.encerrar_sessao()`.execute(tx));
    res.clearCookie(COOKIE_SESSAO, opcoesCookie);
    res.clearCookie(COOKIE_CSRF, opcoesCookie);
  }

  @Post('logout-todas')
  async logoutTodas(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const { manterAtual } = validar(sairTodasSchema, corpo ?? {});
    const s = sessaoDe(req);
    const encerradas = await this.contexto.comContexto(dadosDe(req, s.token), async (tx) => {
      const r = await sql<{ n: number }>`select core.encerrar_todas_sessoes(${manterAtual}) as n`.execute(tx);
      return r.rows[0]?.n ?? 0;
    });
    return { encerradas };
  }

  @Get('sessoes')
  async sessoes(@Req() req: RequisicaoVV) {
    const s = sessaoDe(req);
    return this.contexto.comContexto(dadosDe(req, s.token), async (tx) => {
      const r = await sql`select * from core.minhas_sessoes()`.execute(tx);
      return r.rows;
    });
  }

  @Delete('sessoes/:id')
  @HttpCode(204)
  async encerrar(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    const s = sessaoDe(req);
    await this.contexto.comContexto(dadosDe(req, s.token), (tx) => sql`select core.encerrar_sessao(${id}::uuid)`.execute(tx));
  }

  // Troca logada: cada tentativa conta como falha de verificação ANTES do Argon2 (rajada não ganha
  // palpites extras; 5 encerram a sessão; o sucesso zera). O Argon2 roda fora da transação. Sucesso
  // troca o token desta sessão (rotação) e encerra as outras. Quem tem MFA precisa de MFA recente:
  // conferido antes de contar a falha, e o estorno vai numa transação própria (uma recusa posterior
  // não transforma a senha certa em erro de MFA).
  @Post('senha')
  @HttpCode(200)
  async trocarSenha(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    const { atual, nova } = validar(trocaSenhaSchema, corpo);
    const problema = problemaNaSenha(nova);
    if (problema) throw new BadRequestException(problema);
    if (await senhaVazada(nova, this.config.HIBP_URL, fetch, avisarHibp)) throw new BadRequestException(MSG_VAZADA);
    const s = sessaoDe(req);
    const dados = dadosDe(req, s.token);
    const hashAtual = await this.contexto.comContexto(dados, async (tx) => {
      const pre = await sql<{ falta: boolean }>`
        select (core.tem_mfa() or core.mfa_obrigatorio()) and not core.mfa_recente() as falta`.execute(tx);
      if (pre.rows[0]?.falta !== false) throw new ForbiddenException(MSG_MFA_RECENTE);
      await sql`select core.registrar_falha_verificacao()`.execute(tx);
      const r = await sql<{ h: string | null }>`select core.hash_senha_atual(${this.config.VV_KEK}) as h`.execute(tx);
      return r.rows[0]?.h ?? null;
    });
    let ok: boolean;
    let novoHash: string;
    try {
      ok = await conferirSenha(hashAtual, atual);
      novoHash = ok ? await hashSenha(nova) : '';
    } catch (e) {
      if (e instanceof Argon2Ocupado) throw new ServiceUnavailableException();
      throw e;
    }
    if (!ok) throw new BadRequestException('Senha atual incorreta.');
    const token = novoToken();
    await this.contexto.comContexto(dados, (tx) => sql`select core.estornar_falha_verificacao()`.execute(tx));
    await this.contexto.comContexto(dados, async (tx) => {
      await sql`select core.trocar_senha(${novoHash})`.execute(tx);
      await sql`select core.rotacionar_sessao(${s.token}, ${token})`.execute(tx);
    });
    return emitirTokenRotacionado(res, s, token);
  }
}
