import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Get, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const descartarSchema = z.object({ justificativa: z.string().trim().min(10).max(1000) }).strict();

// Sugestões de esclarecimento e impugnação (spec fase-10, 10.2/10.3). A API só ENFILEIRA o pedido e grava a decisão humana (aceitar abre a peça em
// triagem; descartar exige justificativa). A IA (worker) só sugere, com trecho literal conferido e fundamento só da base verificada.
@Controller()
export class SugestoesController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/sugestoes')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => {
      const sugestoes = (await sql`
        select s.id, s.acompanhamento_id as "acompanhamentoId", s.tipo, s.titulo, s.trecho_edital as trecho, s.pagina, s.duvida, s.impacto, s.pedido, s.fundamento, s.fundamento_na_base as "fundamentoNaBase",
               s.viabilidade, s.viabilidade_justificativa as "viabilidadeJustificativa", s.prazo_legal as "prazoLegal", s.status, s.justificativa_descarte as "justificativaDescarte", s.peca_id as "pecaId",
               e.numero_edital as "numeroEdital", g.razao_social as orgao
          from priv.sugestoes_pecas s join priv.acompanhamentos a on a.id = s.acompanhamento_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
         where s.empresa_id = ${empresa}::uuid order by (s.status = 'nova') desc, s.created_at desc limit 300`.execute(tx)).rows;
      const execucoes = (await sql`
        select distinct on (acompanhamento_id) acompanhamento_id as "acompanhamentoId", status, erro, created_at as "pedidoEm", concluida_em as "concluidaEm", criadas, descartadas
          from priv.sugestoes_execucoes where empresa_id = ${empresa}::uuid order by acompanhamento_id, created_at desc`.execute(tx)).rows;
      return { sugestoes, execucoes };
    });
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/acompanhamentos/:id/sugestoes')
  @HttpCode(202)
  async pedir(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.pedir_sugestoes_pecas(${empresa}::uuid, ${id}::uuid) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'pendente' };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/sugestoes/:id/aceitar')
  @HttpCode(201)
  async aceitar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.aceitar_sugestao(${empresa}::uuid, ${id}::uuid) as id`.execute(tx));
    return { pecaId: r.rows[0]?.id };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/sugestoes/:id/descartar')
  @HttpCode(204)
  async descartar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(descartarSchema, corpo);
    await this.q(req, (tx) => sql`select priv.descartar_sugestao(${empresa}::uuid, ${id}::uuid, ${d.justificativa})`.execute(tx));
  }
}
