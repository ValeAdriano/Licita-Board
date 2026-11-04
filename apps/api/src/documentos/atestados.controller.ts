import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));
// Quantidade é dinheiro-like: string decimal (nunca number), até 4 casas, como numeric(18,4) no banco.
const quantidade = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).refine((q) => Number(q) > 0);
const atestadoSchema = z.object({
  documentoId: z.uuid(), contratante: z.string().trim().min(2).max(200), objeto: z.string().trim().min(2).max(1000),
  periodoInicio: dia.nullable().optional(), periodoFim: dia.nullable().optional(),
  itens: z.array(z.object({ descricao: z.string().trim().min(2).max(300), quantidade, unidadeId: z.uuid() }).strict()).min(1).max(50),
}).strict();

// Atestados de capacidade técnica estruturados (spec fase-03 RF-03.11): o arquivo é um documento do repositório;
// aqui ficam contratante, objeto, período e as quantidades por item, para o cruzamento com as exigências do edital.
@Controller()
export class AtestadosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('documentos', 'visualizar')
  @Get('empresas/:empresa/atestados')
  listar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select a.id, a.documento_id as "documentoId", a.contratante, a.objeto, a.periodo_inicio::text as "periodoInicio", a.periodo_fim::text as "periodoFim",
        coalesce((select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'quantidade', i.quantidade::text, 'unidadeId', i.unidade_id, 'unidade', u.simbolo) order by i.created_at)
                    from priv.atestado_itens i join pub.unidades u on u.id = i.unidade_id where i.atestado_id = a.id), '[]'::jsonb) as itens
        from priv.atestados_tecnicos a where a.empresa_id = ${empresa}::uuid and a.deleted_at is null order by a.created_at desc`.execute(tx)).rows);
  }

  @Permissao('documentos', 'cadastrar')
  @Post('empresas/:empresa/atestados')
  async criar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(atestadoSchema, corpo);
    return this.q(req, async (tx) => {
      const novo = (await sql<{ id: string }>`
        insert into priv.atestados_tecnicos (empresa_id, documento_id, contratante, objeto, periodo_inicio, periodo_fim)
        values (${empresa}::uuid, ${d.documentoId}::uuid, ${d.contratante}, ${d.objeto}, ${d.periodoInicio ?? null}::date, ${d.periodoFim ?? null}::date)
        returning id`.execute(tx)).rows[0];
      if (!novo) throw new NotFoundException();
      const id = novo.id;
      for (const i of d.itens) {
        await sql`insert into priv.atestado_itens (atestado_id, empresa_id, descricao, quantidade, unidade_id)
          values (${id}::uuid, ${empresa}::uuid, ${i.descricao}, ${i.quantidade}::numeric, ${i.unidadeId}::uuid)`.execute(tx);
      }
      return { id };
    });
  }

  @Permissao('documentos', 'arquivar')
  @Post('empresas/:empresa/atestados/:id/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update priv.atestados_tecnicos set deleted_at = now() where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }
}
