import {
  BadRequestException,
  Body,
  ForbiddenException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Config } from '../config.js';
import { ContextoService } from '../db/contexto.service.js';
import { CONFIG } from '../tokens.js';
import { LimitePorIp, novoToken } from './auth.service.js';
import { normalizarCodigoRecuperacao, novoSegredoTotp, novosCodigosRecuperacao, uriOtpAuth } from './mfa.js';
import { MSG_MFA_RECENTE, type RequisicaoVV, dadosDe, emitirTokenRotacionado, ipDe, sessaoDe, validar } from './requisicao.js';
import { Argon2Ocupado, conferirSenha } from './senha.js';
import { PermiteAal1 } from './sessao.guard.js';

const codigoSchema = z.object({ codigo: z.string().trim().regex(/^\d{6}$/) });
const recuperacaoSchema = z.object({
  codigo: z.string().max(64).transform(normalizarCodigoRecuperacao).pipe(z.string().length(20)),
});
const cadastroSchema = z.object({ senha: z.string().min(1).max(1024) });
const stepUpSchema = z.object({
  codigo: z.string().trim().regex(/^\d{6}$/),
  escopo: z.enum(['alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final', 'aprovar_peca']),
});

// MFA (ADR-012, spec fase-01 decisões 1 e 7): o segredo e os códigos são conferidos no banco com a
// KEK; a API só gera o segredo/códigos e os mostra uma vez. Erro de código responde 400 e é gravado
// no banco antes da resposta (a função devolve false, sem rollback); 5 erros encerram a sessão.
// Elevação a aal2 rotaciona o token (sem fixação de sessão após o segundo fator).
@Controller('auth/mfa')
export class MfaController {
  // Limite na borda, por IP (spec §5): o banco ainda limita por sessão e por usuário.
  private readonly limite = new LimitePorIp();

  constructor(
    private readonly contexto: ContextoService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private limitar(req: RequisicaoVV): void {
    if (!this.limite.permitir(ipDe(req))) {
      throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // Exige a senha atual (reautenticação: sessão roubada só com senha não cadastra o próprio
  // autenticador). Primeiro autenticador em aal1; trocar exige MFA recente (o banco recusa: 403).
  // O pendente fica preso a esta sessão e vence em 15 min; no máximo 5 cadastros a cada 15 min.
  @PermiteAal1()
  @Post('cadastrar')
  @HttpCode(200)
  async cadastrar(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    this.limitar(req);
    const { senha } = validar(cadastroSchema, corpo);
    const s = sessaoDe(req);
    const dados = dadosDe(req, s.token);
    // Trocar autenticador exige MFA recente: conferido antes de contar a falha (ver trocarSenha).
    const hash = await this.contexto.comContexto(dados, async (tx) => {
      const pre = await sql<{ falta: boolean }>`select core.tem_mfa() and not core.mfa_recente() as falta`.execute(tx);
      if (pre.rows[0]?.falta !== false) throw new ForbiddenException(MSG_MFA_RECENTE);
      await sql`select core.registrar_falha_verificacao()`.execute(tx);
      const r = await sql<{ h: string | null }>`select core.hash_senha_atual(${this.config.VV_KEK}) as h`.execute(tx);
      return r.rows[0]?.h ?? null;
    });
    let ok: boolean;
    try {
      ok = await conferirSenha(hash, senha);
    } catch (e) {
      if (e instanceof Argon2Ocupado) throw new ServiceUnavailableException();
      throw e;
    }
    if (!ok) throw new BadRequestException('Senha incorreta.');
    const segredo = novoSegredoTotp();
    await this.contexto.comContexto(dados, (tx) => sql`select core.estornar_falha_verificacao()`.execute(tx));
    const r = await this.contexto.comContexto(dados, async (tx) => {
      const v = await sql<{ vence: Date }>`select core.cadastrar_totp(${segredo}, ${this.config.VV_KEK}) as vence`.execute(tx);
      const u = await sql<{ email: string }>`select email::text from core.usuarios where id = core.usuario_atual()`.execute(tx);
      return { vence: v.rows[0]?.vence, email: u.rows[0]?.email ?? '' };
    });
    return { uri: uriOtpAuth(segredo, r.email), venceEm: r.vence };
  }

  // Reset do MFA de outro usuário (desbloqueio): SUPERADMIN com MFA recente, nunca sobre outro
  // SUPERADMIN; invalida a senha do alvo (volta pela recuperação por e-mail); auditado no banco.
  @Post('resetar/:usuario')
  @HttpCode(204)
  async resetar(@Req() req: RequisicaoVV, @Param('usuario', new ParseUUIDPipe()) usuario: string) {
    const s = sessaoDe(req);
    await this.contexto.comContexto(dadosDe(req, s.token), (tx) => sql`select core.resetar_mfa(${usuario}::uuid, ${this.config.VV_KEK})`.execute(tx));
  }

  @PermiteAal1()
  @Post('confirmar')
  @HttpCode(200)
  async confirmar(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    this.limitar(req);
    const { codigo } = validar(codigoSchema, corpo);
    return this.elevar(req, res, 'core.confirmar_totp', codigo);
  }

  @PermiteAal1()
  @Post('verificar')
  @HttpCode(200)
  async verificar(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    this.limitar(req);
    const { codigo } = validar(codigoSchema, corpo);
    return this.elevar(req, res, 'core.verificar_totp', codigo);
  }

  @PermiteAal1()
  @Post('recuperacao')
  @HttpCode(200)
  async recuperacao(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    this.limitar(req);
    const { codigo } = validar(recuperacaoSchema, corpo);
    return this.elevar(req, res, 'core.usar_codigo_recuperacao', codigo);
  }

  // Gera 10 códigos novos (os anteriores deixam de valer). aal2 pelo guard + MFA recente no banco.
  @Post('codigos')
  @HttpCode(200)
  async codigos(@Req() req: RequisicaoVV) {
    const s = sessaoDe(req);
    const codigos = novosCodigosRecuperacao();
    await this.contexto.comContexto(dadosDe(req, s.token), (tx) =>
      sql`select core.gerar_codigos_recuperacao(${codigos}::text[])`.execute(tx));
    return { codigos };
  }

  // Step-up (spec §6 regra 10): TOTP novo agora + fator com ≥ 24 h → token de 5 min, uso único,
  // preso a esta sessão, para a operação crítica do escopo. Rotaciona o token da sessão.
  @Post('step-up')
  @HttpCode(200)
  async stepUp(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    this.limitar(req);
    const { codigo, escopo } = validar(stepUpSchema, corpo);
    const s = sessaoDe(req);
    const token = novoToken();
    const stepUp = await this.contexto.comContexto(dadosDe(req, s.token), async (tx) => {
      const v = await sql<{ ok: boolean }>`select core.verificar_totp(${codigo}, ${this.config.VV_KEK}) as ok`.execute(tx);
      if (v.rows[0]?.ok !== true) return null;
      await sql`select core.rotacionar_sessao(${s.token}, ${token})`.execute(tx);
      const r = await sql<{ id: string }>`select core.iniciar_step_up(${escopo}) as id`.execute(tx);
      return r.rows[0]?.id ?? null;
    });
    if (!stepUp) throw new BadRequestException('Código inválido.');
    return { stepUp, ...emitirTokenRotacionado(res, s, token) };
  }

  private async elevar(
    req: RequisicaoVV,
    res: Response,
    funcao: 'core.confirmar_totp' | 'core.verificar_totp' | 'core.usar_codigo_recuperacao',
    codigo: string,
  ) {
    const s = sessaoDe(req);
    const token = novoToken();
    const ok = await this.contexto.comContexto(dadosDe(req, s.token), async (tx) => {
      const chamada =
        funcao === 'core.usar_codigo_recuperacao'
          ? sql<{ ok: boolean }>`select core.usar_codigo_recuperacao(${codigo}) as ok`
          : funcao === 'core.confirmar_totp'
            ? sql<{ ok: boolean }>`select core.confirmar_totp(${codigo}, ${this.config.VV_KEK}) as ok`
            : sql<{ ok: boolean }>`select core.verificar_totp(${codigo}, ${this.config.VV_KEK}) as ok`;
      const r = await chamada.execute(tx);
      const aceito = r.rows[0]?.ok === true;
      if (aceito) await sql`select core.rotacionar_sessao(${s.token}, ${token})`.execute(tx);
      return aceito;
    });
    if (!ok) throw new BadRequestException('Código inválido.');
    return emitirTokenRotacionado(res, s, token);
  }
}
