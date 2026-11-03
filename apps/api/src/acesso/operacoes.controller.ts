import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const pedidoSchema = z.object({
  tabela: z.literal('core.empresas'),
  id: z.uuid(),
  motivo: z.string().trim().min(10).max(2000),
  stepUp: z.uuid(),
}).strict();
const decisaoSchema = z.object({ aprovar: z.boolean(), stepUp: z.uuid() }).strict();

// Notificações do próprio usuário (a RLS esconde as de empresa sem <modulo>/visualizar) e exclusão
// definitiva com dupla aprovação (só SUPERADMIN; as funções conferem step-up e o segundo aprovador).
@Controller()
export class OperacoesController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Get('notificacoes')
  async notificacoes(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, empresa_id as "empresaId", modulo, tipo, titulo, corpo, link, lida_em as "lidaEm",
             created_at as "criadaEm"
        from core.notificacoes where usuario_id = core.usuario_atual()
       order by created_at desc limit 100`.execute(tx)).rows);
  }

  @Post('notificacoes/:id/lida')
  @HttpCode(204)
  async marcarLida(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`
      update core.notificacoes set lida_em = now() where id = ${id}::uuid and lida_em is null`.execute(tx));
  }

  @Get('exclusoes')
  async exclusoes(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, alvo_tabela as tabela, alvo_id as "alvoId", motivo, status, solicitado_por as "solicitadoPor",
             solicitado_em as "solicitadoEm", expira_em as "expiraEm", resumo_alvo as resumo
        from core.aprovacoes_exclusao order by solicitado_em desc limit 100`.execute(tx)).rows);
  }

  @Post('exclusoes')
  async solicitar(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(pedidoSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      select core.solicitar_exclusao(${d.tabela}, ${d.id}::uuid, ${d.motivo}, ${d.stepUp}::uuid) as id`.execute(tx)).rows[0]);
  }

  @Post('exclusoes/:id/decidir')
  @HttpCode(204)
  async decidir(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(decisaoSchema, corpo);
    await this.q(req, (tx) => sql`select core.decidir_exclusao(${id}::uuid, ${d.aprovar}, ${d.stepUp}::uuid)`.execute(tx));
  }
}
