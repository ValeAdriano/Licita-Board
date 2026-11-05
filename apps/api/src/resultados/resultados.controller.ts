import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const FINAIS = ['arrematada', 'adjudicada', 'homologada', 'contratada', 'perdida', 'inabilitada', 'desclassificada', 'fracassada', 'deserta', 'revogada', 'anulada', 'cancelada'] as const;
// Dinheiro como string decimal (regra 14); o banco guarda numeric(18,4).
const dinheiro = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const resultadoSchema = z.object({
  resultado: z.enum(FINAIS), valorInicial: dinheiro.nullable().optional(), valorFinal: dinheiro.nullable().optional(), classificacao: z.number().int().min(1).max(10000).nullable().optional(),
  melhorLance: dinheiro.nullable().optional(), vencedoraCnpj: z.string().trim().max(30).nullable().optional(), vencedoraNome: z.string().trim().max(200).nullable().optional(),
  vencedoraMarcaModelo: z.string().trim().max(200).nullable().optional(), motivo: z.string().trim().max(1000).nullable().optional(),
  habilitacao: z.enum(['a_confirmar', 'em_analise', 'habilitada', 'inabilitada']).default('a_confirmar'), ocorridoEm: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();
const filtroSchema = z.object({
  q: z.string().trim().max(100).optional(), status: z.string().max(200).optional(), ano: z.coerce.number().int().min(2000).max(2100).optional(),
  orgao: z.string().trim().max(100).optional(), marca: z.string().trim().max(100).optional(),
}).strict();

// Resultados das disputas (spec fase-09). Só REGISTRO: o sistema nunca dá lance nem protocola (regra 17). Perder, ser inabilitada ou
// desclassificada abre a intenção de recurso na agenda (o banco chama o fato; o worker calcula o prazo).
@Controller()
export class ResultadosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/participacoes/:id/resultado')
  async obter(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => (await sql`
      select r.id, r.resultado_final as resultado, r.valor_inicial::text as "valorInicial", r.valor_final::text as "valorFinal", r.classificacao, r.melhor_lance::text as "melhorLance",
             r.vencedora_cnpj as "vencedoraCnpj", r.vencedora_nome as "vencedoraNome", r.vencedora_marca_modelo as "vencedoraMarcaModelo", r.motivo_perda as motivo,
             r.situacao_habilitacao as habilitacao, r.ocorrido_em as "ocorridoEm", r.gatilho_recursal as "gatilhoRecursal"
        from priv.resultados_item r where r.participacao_id = ${id}::uuid and r.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0]);
    return r ?? null;
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/participacoes/:id/resultado')
  @HttpCode(200)
  async registrar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(resultadoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.registrar_resultado(${empresa}::uuid, ${id}::uuid, ${d.resultado}, ${d.valorInicial ?? null}::numeric, ${d.valorFinal ?? null}::numeric, ${d.classificacao ?? null}::int,
        ${d.melhorLance ?? null}::numeric, ${d.vencedoraCnpj ?? null}, ${d.vencedoraNome ?? null}, ${d.vencedoraMarcaModelo ?? null}, ${d.motivo ?? null}, ${d.habilitacao},
        ${d.ocorridoEm ?? null}::timestamptz) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  // Histórico pesquisável (9.4): por texto (órgão, objeto, edital, processo, vencedora, marca, modelo), situação, ano, órgão e marca.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/resultados')
  historico(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(filtroSchema, consulta);
    const status = f.status ? f.status.split(',').filter((s) => (FINAIS as readonly string[]).includes(s)) : null;
    const like = (t?: string) => (t ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);
    return this.q(req, async (tx) => (await sql`
      select r.id, r.participacao_id as "participacaoId", a.id as "acompanhamentoId", r.resultado_final as resultado, r.valor_inicial::text as "valorInicial", r.valor_final::text as "valorFinal",
             r.classificacao, r.melhor_lance::text as "melhorLance", r.vencedora_nome as "vencedoraNome", r.vencedora_cnpj as "vencedoraCnpj", r.vencedora_marca_modelo as "vencedoraMarcaModelo",
             r.motivo_perda as motivo, r.situacao_habilitacao as habilitacao, r.ocorrido_em as "ocorridoEm", r.gatilho_recursal as "gatilhoRecursal",
             i.numero_item as "numeroItem", left(i.descricao, 200) as item, e.numero_edital as "numeroEdital", e.processo, left(e.objeto, 200) as objeto, g.razao_social as orgao, g.uf, g.municipio,
             pa.marca, pa.modelo
        from priv.resultados_item r join priv.participacoes pa on pa.id = r.participacao_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id
        left join pub.edital_itens i on i.id = pa.item_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
       where r.empresa_id = ${empresa}::uuid
         and (${status}::text[] is null or r.resultado_final = any (${status}::text[]))
         and (${f.ano ?? null}::int is null or extract(year from r.ocorrido_em at time zone 'America/Sao_Paulo') = ${f.ano ?? null}::int)
         and (${like(f.orgao)}::text is null or g.razao_social ilike ${like(f.orgao)}::text escape '\\' or g.municipio ilike ${like(f.orgao)}::text escape '\\')
         and (${like(f.marca)}::text is null or pa.marca ilike ${like(f.marca)}::text escape '\\' or pa.modelo ilike ${like(f.marca)}::text escape '\\' or r.vencedora_marca_modelo ilike ${like(f.marca)}::text escape '\\')
         and (${like(f.q)}::text is null or g.razao_social ilike ${like(f.q)}::text escape '\\' or e.objeto ilike ${like(f.q)}::text escape '\\' or e.numero_edital ilike ${like(f.q)}::text escape '\\'
              or e.processo ilike ${like(f.q)}::text escape '\\' or r.vencedora_nome ilike ${like(f.q)}::text escape '\\' or pa.marca ilike ${like(f.q)}::text escape '\\'
              or pa.modelo ilike ${like(f.q)}::text escape '\\' or i.descricao ilike ${like(f.q)}::text escape '\\')
       order by r.ocorrido_em desc limit 200`.execute(tx)).rows);
  }
}
