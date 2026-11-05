import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const TIPOS = ['obrigatorio', 'minimo', 'maximo', 'faixa', 'opcional', 'fabrica', 'certificacao', 'garantia', 'instalacao', 'assistencia', 'prazo_entrega', 'outro'] as const;
// Valores numéricos chegam como string decimal (nunca number: regra 14); o banco guarda numeric(30,12).
const decimal = z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/);
const requisitoSchema = z.object({
  nome: z.string().trim().min(2).max(200), tipo: z.enum(TIPOS).default('obrigatorio'), atributoId: z.uuid().nullable().optional(),
  operador: z.enum(['>=', '<=', '=', 'entre', 'contem', 'sim', 'nao']), valorNumero: decimal.nullable().optional(), valorMax: decimal.nullable().optional(),
  valorTexto: z.string().trim().max(500).nullable().optional(), unidadeId: z.uuid().nullable().optional(), obrigatorio: z.boolean().default(true),
  citacaoEdital: z.string().trim().max(2000).nullable().optional(), pagina: z.number().int().min(1).max(100000).nullable().optional(),
}).strict();
const analiseSchema = z.object({ produtoId: z.uuid() }).strict();
const fichaSchema = z.object({
  documentoId: z.uuid(), pagina: z.number().int().min(1).max(100000), trecho: z.string().trim().min(5).max(2000), ressalva: z.string().trim().max(500).nullable().optional(),
}).strict();

// Análise técnica (spec fase-06). A API NUNCA classifica nem compara: grava o que a pessoa informou (requisitos, a conferência
// da ficha técnica, a aprovação) por função do banco e enfileira o worker, que classifica com código puro (rules/comparacao.py).
@Controller()
export class AnalisesController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('analises', 'visualizar')
  @Get('empresas/:empresa/participacoes/:id/analise')
  async analise(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const p = (await sql`
        select p.id, p.status, i.numero_item as "numeroItem", i.descricao, i.quantidade::text as quantidade, i.unidade_medida as "unidadeMedida",
               a.id as "acompanhamentoId", g.razao_social as orgao, e.numero_edital as "numeroEdital"
          from priv.participacoes p left join pub.edital_itens i on i.id = p.item_id join priv.acompanhamentos a on a.id = p.acompanhamento_id
          left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
         where p.id = ${id}::uuid and p.empresa_id = ${empresa}::uuid and p.deleted_at is null`.execute(tx)).rows[0];
      if (!p) return null;
      const requisitos = (await sql`
        select id, nome, tipo_exigencia as tipo, atributo_id as "atributoId", operador, valor_numero::text as "valorNumero", valor_max::text as "valorMax",
               valor_texto as "valorTexto", unidade_id as "unidadeId", obrigatorio, citacao_edital as "citacaoEdital", pagina, origem
          from priv.requisitos_item where participacao_id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null order by created_at, id`.execute(tx)).rows;
      const analises = (await sql`
        select a.id, a.produto_id as "produtoId", pr.codigo_interno as "codigoInterno", pr.marca, pr.modelo, pr.descricao, a.resumo, a.calculado_em as "calculadoEm",
               a.aprovado_em as "aprovadoEm", a.aprovado_resumo as "aprovadoResumo", u.nome as "aprovadoPor"
          from priv.analises_item a left join priv.produtos pr on pr.id = a.produto_id left join core.usuarios u on u.id = a.aprovado_por
         where a.participacao_id = ${id}::uuid and a.empresa_id = ${empresa}::uuid order by a.created_at`.execute(tx)).rows as { id: string }[];
      const linhas = (await sql`
        select l.id, l.analise_id as "analiseId", l.requisito_id as "requisitoId", l.resultado, l.valor_oferecido as "valorOferecido",
               l.citacao_verificada as "citacaoVerificada", l.pagina_edital as "paginaEdital", l.ficha_trecho as "fichaTrecho", l.ficha_pagina as "fichaPagina",
               l.ficha_documento_id as "fichaDocumentoId", l.ficha_conferida_em as "fichaConferidaEm", c.nome as "fichaConferidaPor", l.ressalva, l.justificativa, l.pendencia
          from priv.analise_linhas l join priv.requisitos_item r on r.id = l.requisito_id and r.deleted_at is null
          left join core.usuarios c on c.id = l.ficha_conferida_por
         where l.empresa_id = ${empresa}::uuid and l.analise_id in (select id from priv.analises_item where participacao_id = ${id}::uuid)`.execute(tx)).rows;
      const produtos = (await sql`
        select id, codigo_interno as "codigoInterno", marca, modelo, descricao from priv.produtos
         where empresa_id = ${empresa}::uuid and deleted_at is null and status_comercial = 'ativo' order by codigo_interno limit 300`.execute(tx)).rows;
      const atributos = (await sql`
        select d.id, d.nome, d.tipo, d.grandeza, c.nome as categoria from pub.atributos_def d join pub.categorias c on c.id = d.categoria_id order by c.nome, d.ordem, d.nome`.execute(tx)).rows;
      const unidades = (await sql`select id, simbolo, grandeza from pub.unidades order by grandeza, simbolo`.execute(tx)).rows;
      return { participacao: p, requisitos, analises: analises.map((a) => ({ ...a, linhas: (linhas as { analiseId: string }[]).filter((l) => l.analiseId === a.id) })), produtos, atributos, unidades };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('analises', 'editar')
  @Post('empresas/:empresa/participacoes/:id/requisitos')
  @HttpCode(201)
  async criarRequisito(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(requisitoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.criar_requisito(${empresa}::uuid, ${id}::uuid, ${d.nome}, ${d.tipo}, ${d.atributoId ?? null}::uuid, ${d.operador}, ${d.valorNumero ?? null}::numeric,
        ${d.valorMax ?? null}::numeric, ${d.valorTexto ?? null}, ${d.unidadeId ?? null}::uuid, ${d.obrigatorio}, ${d.citacaoEdital ?? null}, ${d.pagina ?? null}::int) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('analises', 'editar')
  @Delete('empresas/:empresa/requisitos/:id')
  @HttpCode(204)
  async removerRequisito(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.remover_requisito(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('analises', 'editar')
  @Post('empresas/:empresa/participacoes/:id/analises')
  @HttpCode(202)
  async pedirAnalise(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(analiseSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.analisar_item(${empresa}::uuid, ${id}::uuid, ${d.produtoId}::uuid) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'analisando' };
  }

  @Permissao('analises', 'editar')
  @Post('empresas/:empresa/analise-linhas/:id/ficha')
  @HttpCode(202)
  async conferirFicha(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(fichaSchema, corpo);
    await this.q(req, (tx) => sql`select priv.conferir_ficha(${empresa}::uuid, ${id}::uuid, ${d.documentoId}::uuid, ${d.pagina}::int, ${d.trecho}, ${d.ressalva ?? null})`.execute(tx));
    return { status: 'analisando' };
  }

  @Permissao('analises', 'aprovar')
  @Post('empresas/:empresa/analises/:id/aprovar')
  @HttpCode(204)
  async aprovar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.aprovar_analise(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }
}
