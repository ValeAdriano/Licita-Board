import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService, codigoPg, mensagemPg } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

// Dinheiro e quantidade chegam como STRING decimal (regra 14): nunca number. O banco guarda numeric(18,4) e o worker calcula em Decimal.
const dinheiro = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const percentual = z.string().regex(/^\d{1,2}(\.\d{1,4})?$/);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Data inválida.');
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
const historicoSchema = z.object({
  texto: z.string().trim().min(3).max(120).optional(),
  marca: z.string().trim().max(100).optional(),
  modelo: z.string().trim().max(100).optional(),
  orgao: z.string().trim().max(100).optional(),
  uf: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
  municipio: z.string().trim().max(100).optional(),
  fornecedor: z.string().trim().max(100).optional(),
  de: dia.optional(),
  ate: dia.optional(),
  qtdMin: dinheiro.optional(),
  qtdMax: dinheiro.optional(),
  valorMin: dinheiro.optional(),
  valorMax: dinheiro.optional(),
  unidade: z.string().trim().max(60).optional(),
  incluirCancelados: z.enum(['true', 'false']).optional(),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
}).strict();

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

  // Histórico comercial de preços vencedores do PNCP (7.5): público em pub.precos_historicos, com camada privada só se houver precos/ver_custos_margens.
  @Permissao('editais', 'visualizar')
  @Get('empresas/:empresa/precos/historico')
  async historico(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(historicoSchema, consulta);
    if (f.de && f.ate && f.de > f.ate) throw new BadRequestException('Período inválido.');
    if (f.qtdMin && f.qtdMax && Number(f.qtdMin) > Number(f.qtdMax)) throw new BadRequestException('Faixa de quantidade inválida.');
    if (f.valorMin && f.valorMax && Number(f.valorMin) > Number(f.valorMax)) throw new BadRequestException('Faixa de valor inválida.');
    const like = (t?: string) => (t ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);
    const incCancelados = f.incluirCancelados === 'true';
    const offset = (f.pagina - 1) * 50;

    return this.q(req, async (tx) => {
      const perm = (await sql<{ veCustos: boolean }>`
        select core.has_permission(${empresa}::uuid, 'precos', 'ver_custos_margens') as "veCustos"`.execute(tx)).rows[0];
      const veCustos = Boolean(perm?.veCustos);

      const filtroBase = sql`
        (${incCancelados}::boolean or not ph.cancelado)
        and (${like(f.texto)}::text is null or i.descricao_tsv @@ plainto_tsquery('pub.pt_unaccent', coalesce(${f.texto ?? null}, ''))
             or i.descricao ilike ${like(f.texto)}::text escape '\\' or e.objeto ilike ${like(f.texto)}::text escape '\\')
        and (${like(f.marca)}::text is null or ph.marca ilike ${like(f.marca)}::text escape '\\' or i.descricao ilike ${like(f.marca)}::text escape '\\')
        and (${like(f.modelo)}::text is null or ph.modelo ilike ${like(f.modelo)}::text escape '\\' or i.descricao ilike ${like(f.modelo)}::text escape '\\')
        and (${like(f.orgao)}::text is null or g.razao_social ilike ${like(f.orgao)}::text escape '\\')
        and (${f.uf ?? null}::text is null or g.uf = ${f.uf ?? null}::text)
        and (${like(f.municipio)}::text is null or g.municipio ilike ${like(f.municipio)}::text escape '\\')
        and (${like(f.fornecedor)}::text is null or ph.fornecedor_nome ilike ${like(f.fornecedor)}::text escape '\\'
             or ph.fornecedor_cnpj ilike ${like(f.fornecedor?.replace(/[^0-9A-Za-z]/g, ''))}::text escape '\\')
        and (${f.de ?? null}::date is null or (ph.data_resultado at time zone 'America/Sao_Paulo')::date >= ${f.de ?? null}::date)
        and (${f.ate ?? null}::date is null or (ph.data_resultado at time zone 'America/Sao_Paulo')::date <= ${f.ate ?? null}::date)
        and (${f.qtdMin ?? null}::numeric is null or ph.quantidade >= ${f.qtdMin ?? null}::numeric)
        and (${f.qtdMax ?? null}::numeric is null or ph.quantidade <= ${f.qtdMax ?? null}::numeric)
        and (${f.valorMin ?? null}::numeric is null or ph.valor_unitario >= ${f.valorMin ?? null}::numeric)
        and (${f.valorMax ?? null}::numeric is null or ph.valor_unitario <= ${f.valorMax ?? null}::numeric)
        and (${f.unidade ?? null}::text is null or upper(btrim(coalesce(ph.unidade_medida, i.unidade_medida, ''))) = upper(btrim(${f.unidade ?? null}::text)))`;

      const estRow = (await sql<{
        total: number;
        nValid: number;
        unidadesDistintas: number;
        minimo: string | null;
        mediana: string | null;
        maximo: string | null;
        unidade: string | null;
      }>`
        select count(*)::int as total,
               count(*) filter (where not ph.cancelado and ph.valor_unitario is not null)::int as "nValid",
               count(distinct upper(btrim(coalesce(ph.unidade_medida, i.unidade_medida, 'UN'))))
                 filter (where not ph.cancelado and ph.valor_unitario is not null)::int as "unidadesDistintas",
               (min(ph.valor_unitario) filter (where not ph.cancelado and ph.valor_unitario is not null))::text as minimo,
               (percentile_disc(0.5) within group (order by ph.valor_unitario)
                 filter (where not ph.cancelado and ph.valor_unitario is not null))::numeric(18,4)::text as mediana,
               (max(ph.valor_unitario) filter (where not ph.cancelado and ph.valor_unitario is not null))::text as maximo,
               min(upper(btrim(coalesce(ph.unidade_medida, i.unidade_medida, 'UN'))))
                 filter (where not ph.cancelado and ph.valor_unitario is not null) as unidade
          from pub.precos_historicos ph
          join pub.edital_itens i on i.id = ph.edital_item_id and i.edital_id = ph.edital_id
          join pub.editais e on e.id = ph.edital_id
          left join pub.orgaos g on g.id = e.orgao_id
         where ${filtroBase}`.execute(tx)).rows[0];

      const estatistica = estRow && estRow.nValid > 0 && estRow.unidadesDistintas === 1 && estRow.minimo && estRow.mediana && estRow.maximo && estRow.unidade
        ? {
            n: estRow.nValid,
            minimo: estRow.minimo,
            mediana: estRow.mediana,
            maximo: estRow.maximo,
            unidade: estRow.unidade,
          }
        : null;

      const itens = (await sql`
        select ph.id,
               jsonb_build_object(
                 'id', e.id, 'numero', e.numero_edital, 'processo', e.processo,
                 'orgao', g.razao_social, 'uf', g.uf, 'municipio', g.municipio, 'linkOrigem', ph.link_origem
               ) as edital,
               jsonb_build_object(
                 'id', i.id, 'numero', i.numero_item, 'descricao', left(i.descricao, 300),
                 'unidade', coalesce(ph.unidade_medida, i.unidade_medida)
               ) as item,
               jsonb_build_object(
                 'tipo', ph.fornecedor_tipo, 'cnpj', ph.fornecedor_cnpj,
                 'nome', ph.fornecedor_nome, 'porte', ph.fornecedor_porte
               ) as fornecedor,
               ph.marca, ph.modelo, ph.quantidade::text as quantidade,
               ph.valor_unitario::text as "valorUnitario", ph.valor_total::text as "valorTotal",
               ph.percentual_desconto::text as desconto, ph.data_resultado as "dataResultado",
               ph.situacao, ph.cancelado, ph.ultima_coleta_em as "coletadoEm",
               ${veCustos ? sql`
                 case when pa.id is not null and (ri.id is not null or pr.id is not null) then
                   jsonb_build_object(
                     'nossaOferta', (coalesce(ri.valor_final, pr.preco_final_unit)::numeric(18,4))::text,
                     'nossaClassificacao', ri.classificacao,
                     'nossoCustoUnitario', (pr.custo_direto_unit::numeric(18,4))::text,
                     'nossaMargem', (pr.margem_liquida_pct::numeric(18,4))::text
                   )
                 else null end
               ` : sql`null::jsonb`} as privado
          from pub.precos_historicos ph
          join pub.edital_itens i on i.id = ph.edital_item_id and i.edital_id = ph.edital_id
          join pub.editais e on e.id = ph.edital_id
          left join pub.orgaos g on g.id = e.orgao_id
          ${veCustos ? sql`
            left join priv.participacoes pa on pa.item_id = ph.edital_item_id and pa.empresa_id = ${empresa}::uuid and pa.deleted_at is null
            left join priv.resultados_item ri on ri.participacao_id = pa.id and ri.empresa_id = ${empresa}::uuid
            left join lateral (
              select p.id, p.preco_final_unit, p.custo_direto_unit, p.margem_liquida_pct
                from priv.precificacoes p
               where p.participacao_id = pa.id and p.empresa_id = ${empresa}::uuid and p.deleted_at is null
               order by p.created_at desc limit 1
            ) pr on true
          ` : sql``}
         where ${filtroBase}
         order by ph.data_resultado desc nulls last, ph.created_at desc
         limit 50 offset ${offset}`.execute(tx)).rows;

      return { itens, estatistica, total: estRow?.total ?? 0 };
    });
  }

  @Permissao('editais', 'visualizar')
  @Get('empresas/:empresa/participacoes/:id/historico-sugerido')
  async historicoSugerido(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const pa = (await sql<{ id: string; itemId: string; descricao: string }>`
        select pa.id, pa.item_id as "itemId", left(i.descricao, 120) as descricao
          from priv.participacoes pa
          left join pub.edital_itens i on i.id = pa.item_id
         where pa.id = ${id}::uuid and pa.empresa_id = ${empresa}::uuid and pa.deleted_at is null`.execute(tx)).rows[0];
      if (!pa) return null;
      const resultadosDoItem = (await sql`
        select ph.id, ph.fornecedor_tipo as "fornecedorTipo", ph.fornecedor_cnpj as "fornecedorCnpj",
               ph.fornecedor_nome as "fornecedorNome", ph.fornecedor_porte as "fornecedorPorte",
               ph.marca, ph.modelo, ph.quantidade::text as quantidade, ph.unidade_medida as unidade,
               ph.valor_unitario::text as "valorUnitario", ph.valor_total::text as "valorTotal",
               ph.classificacao, ph.data_resultado as "dataResultado", ph.situacao, ph.link_origem as "linkOrigem"
          from pub.precos_historicos ph
         where ph.edital_item_id = ${pa.itemId}::uuid and not ph.cancelado
         order by ph.classificacao asc nulls last, ph.valor_unitario asc nulls last
         limit 20`.execute(tx)).rows;
      return { itemId: pa.itemId, descricao: pa.descricao, resultadosDoItem };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('editais', 'visualizar')
  @Post('empresas/:empresa/editais/:id/buscar-resultados')
  @HttpCode(202)
  async buscarResultadosEdital(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    try {
      const r = await this.q(req, (tx) => sql<{ jobId: string }>`
        select ops.solicitar_coleta_resultados_edital(${empresa}::uuid, ${id}::uuid) as "jobId"`.execute(tx));
      return { jobId: r.rows[0]?.jobId };
    } catch (e) {
      if (codigoPg(e) === 'P0001') {
        throw new HttpException(mensagemPg(e), HttpStatus.TOO_MANY_REQUESTS);
      }
      throw e;
    }
  }
}
