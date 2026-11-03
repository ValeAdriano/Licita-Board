import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { LimitePorIp } from '../auth/auth.service.js';
import { type RequisicaoVV, dadosDe, ipDe, sessaoDe, validar } from '../auth/requisicao.js';
import type { Config } from '../config.js';
import { ContextoService } from '../db/contexto.service.js';
import { CONFIG } from '../tokens.js';

// Mesma lista fechada do banco (db/migrations/20261103090000): o worker faz POST no endpoint, então só
// serviços de push conhecidos, em https, sem usuário na URL (SSRF). O banco confere de novo.
const ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\/[!-~]+$/;
const endpointSchema = z.string().max(2048).regex(ENDPOINT);
const inscricaoSchema = z.object({
  endpoint: endpointSchema,
  chaves: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict(),
}).strict();
const soEndpointSchema = z.object({ endpoint: endpointSchema }).strict();

// Web Push (ADR-018): o navegador se inscreve; o worker envia (só um aviso genérico, nunca conteúdo).
// A API nunca devolve endpoint nem chaves (o banco nem deixa vv_api lê-los).
@Controller()
export class PushController {
  // Limite na borda, por IP (como nas rotas de MFA): o banco ainda limita 10 dispositivos ativos por usuário.
  private readonly limite = new LimitePorIp();

  private limitar(req: RequisicaoVV): void {
    if (!this.limite.permitir(ipDe(req))) {
      throw new HttpException('Muitas tentativas. Tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  constructor(
    private readonly contexto: ContextoService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private q<T>(req: RequisicaoVV, fn: Parameters<ContextoService['comContexto']>[1]) {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn) as Promise<T>;
  }

  // Chave pública do servidor (applicationServerKey). Sem ela, o push está desligado.
  @Get('push/chave')
  chave() {
    if (!this.config.VAPID_PUBLIC_KEY) throw new NotFoundException();
    return { chave: this.config.VAPID_PUBLIC_KEY };
  }

  @Get('dispositivos-push')
  async listar(@Req() req: RequisicaoVV) {
    return this.q<unknown[]>(req, async (tx) => (await sql`
      select id, user_agent as "userAgent", created_at as "criadoEm", ultimo_envio_em as "ultimoEnvioEm"
        from core.dispositivos_push order by created_at desc`.execute(tx)).rows);
  }

  @Post('dispositivos-push')
  async registrar(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    this.limitar(req);
    const d = validar(inscricaoSchema, corpo);
    return this.q<{ id: string }>(req, async (tx) => (await sql<{ id: string }>`
      select core.registrar_dispositivo_push(${d.endpoint}, ${d.chaves.p256dh}, ${d.chaves.auth}) as id`
      .execute(tx)).rows[0]);
  }

  // O navegador pergunta se esta inscrição já é dele (sem listar endpoints).
  @Post('dispositivos-push/consulta')
  @HttpCode(200)
  async consultar(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    this.limitar(req);
    const d = validar(soEndpointSchema, corpo);
    const id = await this.q<string | null>(req, async (tx) => (await sql<{ id: string | null }>`
      select core.meu_dispositivo_push(${d.endpoint}) as id`.execute(tx)).rows[0]?.id ?? null);
    return { id };
  }

  // Logout: o próximo usuário deste navegador não pode receber os alertas do anterior (T5.26).
  @Post('dispositivos-push/revogar')
  @HttpCode(204)
  async revogarPorEndpoint(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    this.limitar(req);
    const d = validar(soEndpointSchema, corpo);
    await this.q(req, (tx) => sql`select core.revogar_dispositivo_push_endpoint(${d.endpoint})`.execute(tx));
  }

  @Delete('dispositivos-push/:id')
  @HttpCode(204)
  async revogar(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select core.revogar_dispositivo_push(${id}::uuid)`.execute(tx));
  }
}
