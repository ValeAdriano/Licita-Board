import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { codigoPg, ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { alertas } from './alertas.js';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Data inválida.');
// Dinheiro e quantidade como STRING decimal (regra 14); o banco guarda numeric(18,4).
const dec = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const ETAPAS = ['pedido_recebido', 'pedido_fornecedor', 'aguardando_producao', 'produto_disponivel', 'faturamento_autorizado', 'nota_emitida', 'transporte', 'entrega', 'recebimento_provisorio', 'recebimento_definitivo', 'concluido'] as const;
const contratoSchema = z.object({
  tipo: z.enum(['contrato', 'ata']).default('contrato'), numero: z.string().trim().min(1).max(80), orgao: z.string().trim().min(2).max(200), objeto: z.string().trim().min(3).max(2000),
  vigenciaInicio: dia, vigenciaFim: dia, gestorOrgao: z.string().trim().max(200).nullable().optional(), fiscalOrgao: z.string().trim().max(200).nullable().optional(),
  garantiaValor: dec.nullable().optional(), garantiaAte: dia.nullable().optional(), acompanhamentoId: z.uuid().nullable().optional(),
}).strict();
const itemSchema = z.object({ numeroItem: z.number().int().min(1).max(100000), descricao: z.string().trim().min(2).max(2000), unidade: z.string().trim().max(40).nullable().optional(), quantidade: dec, valorUnitario: dec }).strict();
const empenhoSchema = z.object({
  tipo: z.enum(['empenho', 'ordem_fornecimento']).default('empenho'), numero: z.string().trim().min(1).max(80), emitidoEm: dia, prazoEntrega: dia.nullable().optional(), responsavelId: z.uuid().nullable().optional(),
  itens: z.array(z.object({ contratoItemId: z.uuid(), quantidade: dec }).strict()).min(1).max(500),
}).strict();
const etapaSchema = z.object({ etapa: z.enum(ETAPAS), observacao: z.string().trim().max(1000).nullable().optional() }).strict();
const entregaSchema = z.object({ quantidade: dec, data: dia, recebimento: z.enum(['provisorio', 'definitivo']).default('provisorio'), observacao: z.string().trim().max(1000).nullable().optional() }).strict();
const faturaSchema = z.object({ empenhoId: z.uuid().nullable().optional(), numeroNf: z.string().trim().min(1).max(60), emitidaEm: dia, valor: dec, retencoes: dec.default('0'), vencimento: dia }).strict();
const pagamentoSchema = z.object({ pagoEm: dia, valorRecebido: dec, ocorrencia: z.string().trim().max(1000).nullable().optional() }).strict();
const eventoSchema = z.object({
  tipo: z.enum(['aditivo', 'apostilamento', 'prorrogacao', 'reajuste', 'reequilibrio', 'ocorrencia']), data: dia, descricao: z.string().trim().min(3).max(2000), novoValor: dec.nullable().optional(), novaVigencia: dia.nullable().optional(),
}).strict();
const anexoSchema = z.object({ documentoId: z.uuid(), empenhoId: z.uuid().nullable().optional(), etapa: z.enum(ETAPAS).nullable().optional(), nota: z.string().trim().max(300).nullable().optional() }).strict();
const pedidoSchema = z.object({ tipo: z.enum(['reajuste', 'reequilibrio']), titulo: z.string().trim().min(3).max(200) }).strict();
const encerrarSchema = z.object({ status: z.enum(['encerrado', 'rescindido']) }).strict();

// Contratos, empenhos, fornecimento, entregas e financeiro (spec fase-11). Saldos NUNCA vêm do cliente: são calculados aqui e pelo banco.
@Controller()
export class ContratosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('contratos', 'visualizar')
  @Get('empresas/:empresa/contratos')
  lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select c.id, c.tipo, c.numero, c.orgao, left(c.objeto, 200) as objeto, c.status, c.vigencia_inicio::text as "vigenciaInicio", c.vigencia_fim::text as "vigenciaFim", c.valor_total::text as "valorTotal",
             (select round(coalesce(sum(ei.quantidade * ci.valor_unitario), 0), 4)::text from priv.empenho_itens ei join priv.contrato_itens ci on ci.id = ei.contrato_item_id join priv.empenhos e on e.id = ei.empenho_id where e.contrato_id = c.id) as empenhado,
             core.has_permission(c.empresa_id, 'financeiro', 'visualizar') as "veFinanceiro",
             (select coalesce(sum(f.valor), 0)::text from priv.faturas f where f.contrato_id = c.id) as faturado,
             (select coalesce(sum(f.valor_recebido), 0)::text from priv.faturas f where f.contrato_id = c.id) as recebido,
             (now() at time zone 'America/Sao_Paulo')::date::text as hoje
        from priv.contratos c where c.empresa_id = ${empresa}::uuid and c.deleted_at is null order by c.vigencia_fim, c.numero limit 500`.execute(tx)).rows);
  }

  // Resultados "contratada" cujo acompanhamento ainda não tem contrato cadastrado, com os dados do edital para pré-preencher. O valor final do
  // resultado vai como veio (o sistema não decide se é unitário ou total): a pessoa confere ao cadastrar os itens.
  // Os dados vêm do acompanhamento/resultado (módulo agenda), por isso a permissão é a da agenda: sem ela a RLS esconderia as linhas.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/contratos/pendentes-de-cadastro')
  pendentes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select a.id as "acompanhamentoId", ri.participacao_id as "participacaoId", g.razao_social as orgao, e.numero_edital as "numeroEdital", left(e.objeto, 2000) as objeto,
             i.numero_item as "numeroItem", left(i.descricao, 2000) as descricao, i.unidade_medida as unidade, i.quantidade::text as quantidade, ri.valor_final::text as "valorFinal",
             ri.ocorrido_em as "ocorridoEm"
        from priv.resultados_item ri join priv.participacoes pa on pa.id = ri.participacao_id and pa.empresa_id = ri.empresa_id
        join priv.acompanhamentos a on a.id = pa.acompanhamento_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
        left join pub.edital_itens i on i.id = pa.item_id
       where ri.empresa_id = ${empresa}::uuid and ri.resultado_final = 'contratada'
         and not exists (select 1 from priv.contratos c where c.acompanhamento_id = a.id and c.empresa_id = a.empresa_id and c.deleted_at is null)
       order by ri.ocorrido_em desc, i.numero_item limit 300`.execute(tx)).rows);
  }

  // Anexos (11.1/11.3): vínculo com documentos do repositório (Fase 03); validade e status vêm de lá. Sem documentos/visualizar o documento não é visto.
  @Permissao('contratos', 'visualizar')
  @Get('empresas/:empresa/contratos/:id/anexos')
  anexos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select a.id, a.empenho_id as "empenhoId", e.numero as "empenhoNumero", a.etapa, a.nota, a.documento_id as "documentoId", d.descricao, s.status, s.validade::text as validade, a.created_at as "anexadoEm"
        from priv.contrato_anexos a left join priv.empenhos e on e.id = a.empenho_id left join priv.documentos d on d.id = a.documento_id
        left join priv.documentos_status s on s.documento_id = d.id
       where a.contrato_id = ${id}::uuid and a.empresa_id = ${empresa}::uuid order by a.created_at desc`.execute(tx)).rows);
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/contratos/:id/anexos')
  @HttpCode(201)
  async anexar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(anexoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.anexar_documento_contrato(${empresa}::uuid, ${id}::uuid, ${d.documentoId}::uuid, ${d.empenhoId ?? null}::uuid, ${d.etapa ?? null}, ${d.nota ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('contratos', 'editar')
  @Delete('empresas/:empresa/contratos/:id/anexos/:anexo')
  @HttpCode(204)
  async removerAnexo(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('anexo', new ParseUUIDPipe()) anexo: string) {
    await this.q(req, (tx) => sql`select priv.remover_anexo_contrato(${empresa}::uuid, ${anexo}::uuid)`.execute(tx));
  }

  // Pedidos ao órgão (reajuste/reequilíbrio) são peças jurídicas ligadas ao contrato: a tela só lista e abre; quem redige e aprova é o jurídico.
  @Permissao('contratos', 'visualizar')
  @Get('empresas/:empresa/contratos/:id/pedidos')
  pedidos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select p.id, p.tipo, p.titulo, p.status, p.resultado, p.created_at as "criadoEm"
        from priv.pecas p where p.contrato_id = ${id}::uuid and p.empresa_id = ${empresa}::uuid order by p.created_at desc`.execute(tx)).rows);
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/contratos/:id/pedidos')
  @HttpCode(201)
  async abrirPedido(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(pedidoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.abrir_pedido_contratual(${empresa}::uuid, ${id}::uuid, ${d.tipo}, ${d.titulo}) as id`.execute(tx));
    return { pecaId: r.rows[0]?.id };
  }

  @Permissao('contratos', 'visualizar')
  @Get('empresas/:empresa/contratos/:id')
  async detalhe(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const c = (await sql<{ id: string; status: string; vigenciaFim: string; garantiaAte: string | null; veFinanceiro: boolean; hoje: string }>`
        select c.id, c.tipo, c.numero, c.orgao, c.objeto, c.status, c.acompanhamento_id as "acompanhamentoId", c.vigencia_inicio::text as "vigenciaInicio", c.vigencia_fim::text as "vigenciaFim", c.valor_total::text as "valorTotal",
               c.gestor_orgao as "gestorOrgao", c.fiscal_orgao as "fiscalOrgao", c.garantia_valor::text as "garantiaValor", c.garantia_ate::text as "garantiaAte",
               core.has_permission(c.empresa_id, 'financeiro', 'visualizar') as "veFinanceiro", (now() at time zone 'America/Sao_Paulo')::date::text as hoje
          from priv.contratos c where c.id = ${id}::uuid and c.empresa_id = ${empresa}::uuid and c.deleted_at is null`.execute(tx)).rows[0];
      if (!c) return null;
      const itens = (await sql`
        select ci.id, ci.numero_item as "numeroItem", ci.descricao, ci.unidade, ci.quantidade::text as quantidade, ci.valor_unitario::text as "valorUnitario",
               coalesce((select sum(ei.quantidade) from priv.empenho_itens ei where ei.contrato_item_id = ci.id), 0)::text as empenhado,
               coalesce((select sum(en.quantidade) from priv.entregas en join priv.empenho_itens ei on ei.id = en.empenho_item_id where ei.contrato_item_id = ci.id), 0)::text as entregue,
               (ci.quantidade - coalesce((select sum(ei.quantidade) from priv.empenho_itens ei where ei.contrato_item_id = ci.id), 0))::text as "saldoAEmpenhar"
          from priv.contrato_itens ci where ci.contrato_id = ${id}::uuid order by ci.numero_item`.execute(tx)).rows;
      const empenhos = (await sql<{ id: string; numero: string; prazoEntrega: string | null; etapa: string }>`
        select e.id, e.tipo, e.numero, e.emitido_em::text as "emitidoEm", e.prazo_entrega::text as "prazoEntrega", e.etapa, u.nome as responsavel, e.observacao,
               coalesce((select jsonb_agg(jsonb_build_object('id', ei.id, 'contratoItemId', ei.contrato_item_id, 'numeroItem', ci.numero_item, 'quantidade', ei.quantidade::text,
                          'entregue', coalesce((select sum(en.quantidade) from priv.entregas en where en.empenho_item_id = ei.id), 0)::text) order by ci.numero_item)
                          from priv.empenho_itens ei join priv.contrato_itens ci on ci.id = ei.contrato_item_id where ei.empenho_id = e.id), '[]'::jsonb) as itens,
               coalesce((select jsonb_agg(jsonb_build_object('etapa', et.etapa, 'quando', et.quando, 'observacao', et.observacao) order by et.quando) from priv.empenho_etapas et where et.empenho_id = e.id), '[]'::jsonb) as etapas,
               coalesce((select jsonb_agg(jsonb_build_object('id', en.id, 'empenhoItemId', en.empenho_item_id, 'quantidade', en.quantidade::text, 'data', en.entregue_em::text, 'recebimento', en.recebimento, 'observacao', en.observacao) order by en.entregue_em)
                          from priv.entregas en join priv.empenho_itens ei on ei.id = en.empenho_item_id where ei.empenho_id = e.id), '[]'::jsonb) as entregas
          from priv.empenhos e left join core.usuarios u on u.id = e.responsavel_id where e.contrato_id = ${id}::uuid order by e.emitido_em, e.numero`.execute(tx)).rows;
      // Sem financeiro/visualizar o banco devolve vazio: o cliente recebe `faturas: null` (e nunca um zero enganoso).
      const faturas = c.veFinanceiro ? (await sql<{ numeroNf: string; vencimento: string; pagoEm: string | null }>`
        select f.id, f.empenho_id as "empenhoId", f.numero_nf as "numeroNf", f.emitida_em::text as "emitidaEm", f.valor::text as valor, f.retencoes::text as retencoes, f.vencimento::text as vencimento,
               f.pago_em::text as "pagoEm", f.valor_recebido::text as "valorRecebido", f.ocorrencia,
               case when f.pago_em is null and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date then ((now() at time zone 'America/Sao_Paulo')::date - f.vencimento) else 0 end as "diasAtraso",
               (f.valor - f.retencoes - coalesce(f.valor_recebido, 0))::text as "aReceber"
          from priv.faturas f where f.contrato_id = ${id}::uuid order by f.emitida_em, f.numero_nf`.execute(tx)).rows : null;
      const eventos = (await sql`
        select id, tipo, data::text as data, descricao, valor_antes::text as "valorAntes", valor_depois::text as "valorDepois", vigencia_antes::text as "vigenciaAntes", vigencia_depois::text as "vigenciaDepois"
          from priv.contrato_eventos where contrato_id = ${id}::uuid order by data, registrado_em`.execute(tx)).rows;
      return { contrato: c, itens, empenhos, faturas, eventos };
    });
    if (!r) throw new NotFoundException();
    const { contrato, empenhos, faturas } = r;
    return { ...r, alertas: alertas({ hoje: contrato.hoje, vigenciaFim: contrato.vigenciaFim, garantiaAte: contrato.garantiaAte, status: contrato.status, empenhos, faturas }) };
  }

  @Permissao('contratos', 'cadastrar')
  @Post('empresas/:empresa/contratos')
  @HttpCode(201)
  async criar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(contratoSchema, corpo);
    const r = await this.q(req, async (tx) => {
      try {
        return await sql<{ id: string }>`select priv.criar_contrato(${empresa}::uuid, ${d.acompanhamentoId ?? null}::uuid, ${d.tipo}, ${d.numero}, ${d.orgao}, ${d.objeto}, ${d.vigenciaInicio}::date, ${d.vigenciaFim}::date,
      ${d.gestorOrgao ?? null}, ${d.fiscalOrgao ?? null}, ${d.garantiaValor ?? null}::numeric, ${d.garantiaAte ?? null}::date) as id`.execute(tx);
      } catch (e) {
        // A FK composta confere a empresa sem exigir agenda/visualizar do operador.
        if (codigoPg(e) === '23503' && typeof e === 'object' && e !== null && 'constraint' in e
          && e.constraint === 'contratos_acompanhamento_id_empresa_id_fkey') throw new NotFoundException();
        throw e;
      }
    });
    return { id: r.rows[0]?.id };
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/contratos/:id/itens')
  @HttpCode(201)
  async item(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(itemSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.adicionar_item_contrato(${empresa}::uuid, ${id}::uuid, ${d.numeroItem}::int, ${d.descricao}, ${d.unidade ?? null}, ${d.quantidade}::numeric, ${d.valorUnitario}::numeric) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/contratos/:id/empenhos')
  @HttpCode(201)
  async empenho(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(empenhoSchema, corpo);
    const itens = JSON.stringify(d.itens.map((i) => ({ contrato_item_id: i.contratoItemId, quantidade: i.quantidade })));
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.registrar_empenho(${empresa}::uuid, ${id}::uuid, ${d.tipo}, ${d.numero}, ${d.emitidoEm}::date, ${d.prazoEntrega ?? null}::date, ${d.responsavelId ?? null}::uuid, ${itens}::jsonb) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/empenhos/:id/etapa')
  @HttpCode(204)
  async etapa(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(etapaSchema, corpo);
    await this.q(req, (tx) => sql`select priv.mudar_etapa_empenho(${empresa}::uuid, ${id}::uuid, ${d.etapa}, ${d.observacao ?? null})`.execute(tx));
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/empenho-itens/:id/entregas')
  @HttpCode(201)
  async entrega(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(entregaSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.registrar_entrega(${empresa}::uuid, ${id}::uuid, ${d.quantidade}::numeric, ${d.data}::date, ${d.recebimento}, ${d.observacao ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('financeiro', 'editar')
  @Post('empresas/:empresa/contratos/:id/faturas')
  @HttpCode(201)
  async fatura(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(faturaSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.registrar_fatura(${empresa}::uuid, ${id}::uuid, ${d.empenhoId ?? null}::uuid, ${d.numeroNf}, ${d.emitidaEm}::date, ${d.valor}::numeric, ${d.retencoes}::numeric, ${d.vencimento}::date) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('financeiro', 'editar')
  @Post('empresas/:empresa/faturas/:id/pagamento')
  @HttpCode(204)
  async pagamento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(pagamentoSchema, corpo);
    await this.q(req, (tx) => sql`select priv.registrar_pagamento(${empresa}::uuid, ${id}::uuid, ${d.pagoEm}::date, ${d.valorRecebido}::numeric, ${d.ocorrencia ?? null})`.execute(tx));
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/contratos/:id/eventos')
  @HttpCode(201)
  async evento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(eventoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.registrar_evento_contrato(${empresa}::uuid, ${id}::uuid, ${d.tipo}, ${d.data}::date, ${d.descricao}, ${d.novoValor ?? null}::numeric, ${d.novaVigencia ?? null}::date) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('contratos', 'editar')
  @Post('empresas/:empresa/contratos/:id/encerrar')
  @HttpCode(204)
  async encerrar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(encerrarSchema, corpo);
    await this.q(req, (tx) => sql`select priv.encerrar_contrato(${empresa}::uuid, ${id}::uuid, ${d.status})`.execute(tx));
  }
}
