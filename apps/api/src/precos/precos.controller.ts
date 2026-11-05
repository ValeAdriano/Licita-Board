import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

// Dinheiro e quantidade chegam como STRING decimal (regra 14): nunca number. O banco guarda numeric(18,4) e o worker calcula em Decimal.
const dinheiro = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const percentual = z.string().regex(/^\d{1,2}(\.\d{1,4})?$/);
const TIPOS = ['aquisicao', 'frete', 'seguro', 'instalacao', 'acessorio', 'garantia_adicional', 'encargo_financeiro', 'contingencia', 'despesa_administrativa', 'comissao', 'tributo', 'outro'] as const;
const criarSchema = z.object({ produtoId: z.uuid().nullable().optional(), quantidade: dinheiro.nullable().optional() }).strict();
const parametrosSchema = z.object({
  quantidade: dinheiro, margemDesejada: percentual, margemMinima: percentual, casas: z.number().int().min(2).max(6), arredondamento: z.enum(['half_up', 'truncar']),
  precoProposto: dinheiro.nullable().optional(), limiteInexequivel: percentual.nullable().optional(), meEpp: z.boolean().default(false), modalidade: z.enum(['pregao', 'outras']).nullable().optional(),
}).strict();
const linhaSchema = z.object({
  nome: z.string().trim().min(2).max(120), tipo: z.enum(TIPOS), categoria: z.enum(['custo', 'percentual']), forma: z.enum(['por_unidade', 'total_lote']).nullable().optional(),
  valor: dinheiro.nullable().optional(), percentual: percentual.nullable().optional(),
}).strict();
const aprovarSchema = z.object({ justificativa: z.string().trim().max(1000).nullable().optional(), stepUp: z.uuid().nullable().optional() }).strict();

// Formação de preços (spec fase-07). A API NUNCA calcula: grava os insumos por função do banco e enfileira o worker (rules/precos.py).
// Custos e margens são sigilo comercial: só quem tem `precos/ver_custos_margens` lê (o banco devolve vazio sem a ação).
@Controller()
export class PrecosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('precos', 'ver_custos_margens')
  @Get('empresas/:empresa/participacoes/:id/preco')
  async preco(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => {
      const p = (await sql`
        select p.id, p.produto_id as "produtoId", p.quantidade::text as quantidade, p.valor_estimado_unit::text as "valorEstimadoUnit", p.margem_desejada_pct::text as "margemDesejada",
               p.margem_minima_pct::text as "margemMinima", p.casas_unitario as casas, p.arredondamento, p.preco_proposto_unit::text as "precoProposto",
               p.limite_inexequivel_pct::text as "limiteInexequivel", p.me_epp as "meEpp", p.modalidade_empate as modalidade,
               p.custo_direto_unit::text as "custoDiretoUnit", p.percentuais_sobre_preco::text as "percentuaisSobrePreco", p.preco_minimo_unit::text as "precoMinimoUnit",
               p.preco_oferta_unit::text as "precoOfertaUnit", p.preco_final_unit::text as "precoFinalUnit", p.total_proposta::text as "totalProposta",
               p.margem_bruta_pct::text as "margemBruta", p.margem_liquida_pct::text as "margemLiquida", p.diferenca_estimado_pct::text as "diferencaEstimado",
               p.abaixo_do_minimo as "abaixoDoMinimo", p.risco_inexequivel as "riscoInexequivel", p.erro_calculo as "erroCalculo", p.calculado_em as "calculadoEm",
               p.justificativa_abaixo as "justificativaAbaixo", p.aprovado_em as "aprovadoEm", u.nome as "aprovadoPor"
          from priv.precificacoes p left join core.usuarios u on u.id = p.aprovado_por
         where p.participacao_id = ${id}::uuid and p.empresa_id = ${empresa}::uuid and p.deleted_at is null order by p.created_at limit 1`.execute(tx)).rows[0] ?? null;
      const item = (await sql`
        select i.numero_item as "numeroItem", i.descricao, i.quantidade::text as quantidade, i.unidade_medida as "unidadeMedida", i.valor_unitario_estimado::text as "valorUnitarioEstimado"
          from priv.participacoes pa left join pub.edital_itens i on i.id = pa.item_id where pa.id = ${id}::uuid and pa.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0] ?? null;
      if (!p && !item) throw new NotFoundException();
      const linhas = p ? (await sql`
        select l.id, l.nome, l.tipo, l.categoria, l.forma, l.valor::text as valor, l.percentual::text as percentual, l.validado_em as "validadoEm", u.nome as "validadoPor"
          from priv.preco_linhas l left join core.usuarios u on u.id = l.validado_por
         where l.precificacao_id = ${(p as { id: string }).id}::uuid and l.empresa_id = ${empresa}::uuid and l.deleted_at is null order by l.created_at, l.id`.execute(tx)).rows : [];
      const produtos = (await sql`select id, codigo_interno as "codigoInterno", marca, modelo, descricao from priv.produtos where empresa_id = ${empresa}::uuid and deleted_at is null and status_comercial = 'ativo' order by codigo_interno limit 300`.execute(tx)).rows;
      return { precificacao: p, item, linhas, produtos };
    });
  }

  @Permissao('precos', 'editar')
  @Post('empresas/:empresa/participacoes/:id/preco')
  @HttpCode(201)
  async criar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(criarSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.criar_precificacao(${empresa}::uuid, ${id}::uuid, ${d.produtoId ?? null}::uuid, ${d.quantidade ?? null}::numeric) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'calculando' };
  }

  @Permissao('precos', 'editar')
  @Post('empresas/:empresa/precificacoes/:id/parametros')
  @HttpCode(202)
  async parametros(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(parametrosSchema, corpo);
    await this.q(req, (tx) => sql`select priv.salvar_parametros_preco(${empresa}::uuid, ${id}::uuid, ${d.quantidade}::numeric, ${d.margemDesejada}::numeric, ${d.margemMinima}::numeric,
      ${d.casas}::int, ${d.arredondamento}, ${d.precoProposto ?? null}::numeric, ${d.limiteInexequivel ?? null}::numeric, ${d.meEpp}, ${d.modalidade ?? null})`.execute(tx));
    return { status: 'calculando' };
  }

  @Permissao('precos', 'editar')
  @Post('empresas/:empresa/precificacoes/:id/linhas')
  @HttpCode(201)
  async adicionarLinha(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(linhaSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.adicionar_linha_preco(${empresa}::uuid, ${id}::uuid, ${d.nome}, ${d.tipo}, ${d.categoria}, ${d.forma ?? null},
      ${d.valor ?? null}::numeric, ${d.percentual ?? null}::numeric) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'calculando' };
  }

  @Permissao('precos', 'editar')
  @Delete('empresas/:empresa/preco-linhas/:id')
  @HttpCode(204)
  async removerLinha(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.remover_linha_preco(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('precos', 'aprovar')
  @Post('empresas/:empresa/preco-linhas/:id/validar')
  @HttpCode(204)
  async validarLinha(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.validar_linha_preco(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('precos', 'aprovar')
  @Post('empresas/:empresa/precificacoes/:id/aprovar')
  @HttpCode(204)
  async aprovar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(aprovarSchema, corpo);
    await this.q(req, (tx) => sql`select priv.aprovar_preco(${empresa}::uuid, ${id}::uuid, ${d.justificativa ?? null}, ${d.stepUp ?? null}::uuid)`.execute(tx));
  }
}
