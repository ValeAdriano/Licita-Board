import { randomBytes } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Config } from '../config.js';
import { ContextoService, type DadosRequisicao } from '../db/contexto.service.js';
import { CONFIG } from '../tokens.js';
import { ContadorFalhas, captchaValido } from './protecoes.js';
import { Argon2Ocupado, conferirSenha, obterHashFalso } from './senha.js';

export type Plataforma = 'web' | 'ios' | 'android';
export type EstadoMfa = 'verificar' | 'cadastrar' | 'nao_requerido';

export interface ResultadoLogin {
  token: string;
  csrf: string;
  mfa: EstadoMfa;
}

export const MSG_LOGIN = 'E-mail ou senha incorretos.';

export function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

// Limite na borda da API, antes de qualquer acesso ao banco (T7.2): 20 logins/min por IP (IPv6 por
// /64). O banco tem o limite fino (10/min por IP, 10 falhas por e-mail); este só segura inundação.
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 20;

export function chaveDeIp(ip: string | null): string {
  if (!ip) return 'sem-ip';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

export class LimitePorIp {
  private readonly pedidos = new Map<string, number[]>();

  permitir(ip: string | null, agora = Date.now()): boolean {
    const chave = chaveDeIp(ip);
    const recentes = (this.pedidos.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
    if (recentes.length >= MAX_POR_JANELA) {
      this.pedidos.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    this.pedidos.set(chave, recentes);
    if (this.pedidos.size > 10_000) {
      for (const [k, v] of this.pedidos) if (v.every((t) => agora - t >= JANELA_MS)) this.pedidos.delete(k);
    }
    return true;
  }
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly limite = new LimitePorIp();
  private readonly falhas = new ContadorFalhas();

  constructor(
    private readonly contexto: ContextoService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  // Calcula o hash falso na subida: se falhar, a API não sobe (em vez de dar 500 em todo login).
  async onModuleInit(): Promise<void> {
    await obterHashFalso();
  }

  private async recusar(): Promise<never> {
    if (this.config.LOGIN_ATRASO_MS > 0) await esperar(this.config.LOGIN_ATRASO_MS);
    throw new UnauthorizedException(MSG_LOGIN);
  }

  // Resposta igual para e-mail inexistente, senha errada, usuário inativo ou bloqueado (sem
  // enumeração). O banco registra a tentativa como falha ANTES do Argon2 (serializado por e-mail), então
  // rajadas paralelas não passam do limite; conta bloqueada ou IP no limite nem chegam a conferir a senha.
  // CAPTCHA a partir da 3ª falha (por e-mail ou por IP) quando o Turnstile está configurado.
  async exigirCaptcha(chaves: string[], resposta: string | undefined, ip: string | null): Promise<void> {
    const segredo = this.config.TURNSTILE_SECRET;
    if (!segredo || !chaves.some((c) => this.falhas.quantas(c) >= 3)) return;
    if (!(await captchaValido(segredo, resposta, ip))) throw new BadRequestException('CAPTCHA');
  }

  registrarFalha(...chaves: string[]): void {
    for (const c of chaves) this.falhas.registrar(c);
  }

  async login(
    email: string,
    senha: string,
    plataforma: Plataforma,
    ip: string | null,
    userAgent: string | null,
    captcha?: string,
  ): Promise<ResultadoLogin> {
    if (!this.limite.permitir(ip)) {
      throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const chaves = [`email:${email.toLowerCase()}`, `ip:${chaveDeIp(ip)}`];
    await this.exigirCaptcha(chaves, captcha, ip);
    const prep = await this.contexto.semSessao(async (tx) => {
      const r = await sql<{ tentativa_id: string; usuario_id: string | null; senha_hash: string | null; motivo: string }>`
        select * from core.preparar_login(${email}, ${ip}::inet, ${this.config.VV_KEK})`.execute(tx);
      return r.rows[0];
    });
    if (prep?.motivo === 'limite_ip') {
      throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }

    let senhaOk: boolean;
    try {
      // Bloqueado: confere contra o hash falso, para gastar o mesmo tempo.
      senhaOk = await conferirSenha(prep?.motivo === 'ok' ? prep.senha_hash : null, senha);
    } catch (e) {
      if (e instanceof Argon2Ocupado) throw new ServiceUnavailableException();
      throw e;
    }
    if (!senhaOk || !prep?.usuario_id) {
      this.registrarFalha(...chaves);
      return this.recusar();
    }
    this.falhas.limpar(chaves[0] ?? '');

    const token = novoToken();
    const usuario = prep.usuario_id;
    try {
      await this.contexto.semSessao(async (tx) => {
        await sql`select core.concluir_login(${prep.tentativa_id}::uuid, ${usuario}::uuid, ${token},
                    ${ip}::inet, ${userAgent}, ${plataforma}, ${this.config.VV_KEK})`.execute(tx);
      });
    } catch (e) {
      // Corrida perdida para o bloqueio: mesma resposta e mesmo atraso da senha errada.
      if (e instanceof UnauthorizedException) return this.recusar();
      throw e;
    }
    const mfa = await this.estadoMfa({ token, ip, userAgent });
    return { token, csrf: novoToken(), mfa };
  }

  async estadoMfa(req: DadosRequisicao): Promise<EstadoMfa> {
    return this.contexto.comContexto(req, async (tx) => {
      const r = await sql<{ tem: boolean; obrigatorio: boolean; aal: string }>`
        select core.tem_mfa() as tem, core.mfa_obrigatorio() as obrigatorio, core.aal_atual() as aal`.execute(tx);
      const e = r.rows[0];
      if (!e || e.aal === 'aal2') return 'nao_requerido';
      if (e.tem) return 'verificar';
      return e.obrigatorio ? 'cadastrar' : 'nao_requerido';
    });
  }
}
