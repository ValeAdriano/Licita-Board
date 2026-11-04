import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { valorAtributoSchema } from './catalogo.controller.js';

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const dinheiro = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).nullable().optional();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));
const produtoBase = {
  modeloId: z.uuid().nullable().optional(), categoriaId: z.uuid(), subcategoriaId: z.uuid().nullable().optional(),
  codigoInterno: z.string().trim().min(1).max(60), marca: texto(120), modelo: texto(120), versao: texto(120),
  descricao: z.string().trim().min(2).max(2000), unidadeFornecimentoId: z.uuid().nullable().optional(),
  prazoEntregaDias: z.number().int().min(0).max(3650).nullable().optional(), garantiaMeses: z.number().int().min(0).max(600).nullable().optional(),
  disponibilidade: z.enum(['imediata', 'sob_encomenda', 'indisponivel']).nullable().optional(), fornecedor: texto(200),
  statusComercial: z.enum(['ativo', 'suspenso', 'descontinuado']).optional(),
};
const novoSchema = z.object(produtoBase).strict();
const edicaoSchema = z.object({ ...produtoBase, categoriaId: z.uuid().optional(), codigoInterno: produtoBase.codigoInterno.optional(), descricao: produtoBase.descricao.optional() }).strict();
const precosSchema = z.object({ precoCusto: dinheiro, precoReferencia: dinheiro }).strict();
const atributosSchema = z.object({ atributos: z.array(valorAtributoSchema).max(200) }).strict();
const fichaSchema = z.object({
  modeloId: z.uuid().nullable().optional(), fabricante: z.string().trim().min(1).max(120), modelo: z.string().trim().min(1).max(120),
  versaoProduto: texto(120), ano: z.number().int().min(1900).max(2100).nullable().optional(), dataEmissao: dia.nullable().optional(),
  fonteOficial: texto(300), validaAte: dia.nullable().optional(),
}).strict();
const fichaEdicaoSchema = z.object({ situacao: z.enum(['descontinuada', 'vigente']) }).strict();

const COLUNAS = {
  modeloId: 'modelo_id', categoriaId: 'categoria_id', subcategoriaId: 'subcategoria_id', codigoInterno: 'codigo_interno', marca: 'marca',
  modelo: 'modelo', versao: 'versao', descricao: 'descricao', unidadeFornecimentoId: 'unidade_fornecimento_id', prazoEntregaDias: 'prazo_entrega_dias',
  garantiaMeses: 'garantia_meses', disponibilidade: 'disponibilidade', fornecedor: 'fornecedor', statusComercial: 'status_comercial',
} as const;

// Produtos da empresa (spec fase-02 §3.3). Custo e preço de referência ficam em outra tabela, só para
// quem tem produtos/ver_custos_margens; o modelo técnico (pub.modelos) é compartilhado e sem preço.
@Controller()
export class ProdutosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('produtos', 'visualizar')
  @Get('empresas/:empresa/produtos')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query('q') q: unknown, @Query('categoria') categoria: unknown, @Query('status') status: unknown) {
    const busca = q === undefined ? null : validar(z.string().trim().min(1).max(80), q);
    const cat = categoria === undefined ? null : validar(z.uuid(), categoria);
    const st = status === undefined ? null : validar(z.enum(['ativo', 'suspenso', 'descontinuado']), status);
    return this.q(req, async (tx) => (await sql`
      select id, codigo_interno as "codigoInterno", marca, modelo, versao, descricao, categoria_id as "categoriaId", modelo_id as "modeloId",
             status_comercial as "statusComercial", disponibilidade, prazo_entrega_dias as "prazoEntregaDias", garantia_meses as "garantiaMeses", fornecedor
        from priv.produtos
       where empresa_id = ${empresa}::uuid and deleted_at is null
         and (${busca}::text is null or descricao ilike '%' || ${busca} || '%' or codigo_interno ilike '%' || ${busca} || '%' or modelo ilike '%' || ${busca} || '%')
         and (${cat}::uuid is null or categoria_id = ${cat}::uuid or subcategoria_id = ${cat}::uuid)
         and (${st}::text is null or status_comercial = ${st})
       order by codigo_interno limit 500`.execute(tx)).rows);
  }

  @Permissao('produtos', 'visualizar')
  @Get('empresas/:empresa/produtos/:id')
  async um(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const p = await this.q(req, async (tx) => (await sql`
      select id, codigo_interno as "codigoInterno", marca, modelo, versao, descricao, categoria_id as "categoriaId", subcategoria_id as "subcategoriaId",
             modelo_id as "modeloId", unidade_fornecimento_id as "unidadeFornecimentoId", status_comercial as "statusComercial", disponibilidade,
             prazo_entrega_dias as "prazoEntregaDias", garantia_meses as "garantiaMeses", fornecedor
        from priv.produtos where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx)).rows[0]);
    if (!p) throw new NotFoundException();
    return p;
  }

  @Permissao('produtos', 'cadastrar')
  @Post('empresas/:empresa/produtos')
  async novo(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(novoSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into priv.produtos (empresa_id, modelo_id, categoria_id, subcategoria_id, codigo_interno, marca, modelo, versao, descricao,
                                 unidade_fornecimento_id, prazo_entrega_dias, garantia_meses, disponibilidade, fornecedor, status_comercial)
      values (${empresa}::uuid, ${d.modeloId ?? null}::uuid, ${d.categoriaId}::uuid, ${d.subcategoriaId ?? null}::uuid, ${d.codigoInterno}, ${d.marca ?? null},
              ${d.modelo ?? null}, ${d.versao ?? null}, ${d.descricao}, ${d.unidadeFornecimentoId ?? null}::uuid, ${d.prazoEntregaDias ?? null},
              ${d.garantiaMeses ?? null}, ${d.disponibilidade ?? null}, ${d.fornecedor ?? null}, ${d.statusComercial ?? 'ativo'}) returning id`.execute(tx)).rows[0]);
  }

  @Permissao('produtos', 'editar')
  @Patch('empresas/:empresa/produtos/:id')
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(edicaoSchema, corpo);
    const atrib = (Object.keys(COLUNAS) as (keyof typeof COLUNAS)[]).filter((k) => d[k] !== undefined).map((k) => sql`${sql.ref(COLUNAS[k])} = ${d[k] ?? null}`);
    if (atrib.length === 0) throw new BadRequestException('Dados inválidos.');
    const r = await this.q(req, (tx) => sql`
      update priv.produtos set ${sql.join(atrib)} where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
    return {};
  }

  @Permissao('produtos', 'arquivar')
  @Post('empresas/:empresa/produtos/:id/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update priv.produtos set deleted_at = now() where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  // Custo e preço de referência: só com ver_custos_margens (a RLS repete a regra).
  @Permissao('produtos', 'ver_custos_margens')
  @Get('empresas/:empresa/produtos/:id/precos')
  async precos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const p = await this.q(req, async (tx) => (await sql`
      select preco_custo::text as "precoCusto", preco_referencia::text as "precoReferencia" from priv.produto_precos
       where produto_id = ${id}::uuid and empresa_id = ${empresa}::uuid`.execute(tx)).rows[0]);
    return p ?? { precoCusto: null, precoReferencia: null };
  }

  @Permissao('produtos', 'ver_custos_margens')
  @Put('empresas/:empresa/produtos/:id/precos')
  @HttpCode(204)
  async salvarPrecos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(precosSchema, corpo);
    await this.q(req, async (tx) => {
      const ok = await sql`select 1 from priv.produtos where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx);
      if (!ok.rows.length) throw new NotFoundException();
      await sql`insert into priv.produto_precos (produto_id, empresa_id, preco_custo, preco_referencia)
                values (${id}::uuid, ${empresa}::uuid, ${d.precoCusto ?? null}::numeric, ${d.precoReferencia ?? null}::numeric)
                on conflict (produto_id) do update set preco_custo = excluded.preco_custo, preco_referencia = excluded.preco_referencia`.execute(tx);
    });
  }

  @Permissao('produtos', 'visualizar')
  @Get('empresas/:empresa/produtos/:id/atributos')
  async atributos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select atributo_id as "atributoId", valor_numero::text as "valorNumero", valor_texto as "valorTexto", valor_booleano as "valorBooleano", unidade_id as "unidadeId"
        from priv.produto_atributos where produto_id = ${id}::uuid and empresa_id = ${empresa}::uuid`.execute(tx)).rows);
  }

  // O conjunto enviado substitui os atributos do produto (tipo, lista e unidade conferidos no banco).
  @Permissao('produtos', 'editar')
  @Put('empresas/:empresa/produtos/:id/atributos')
  @HttpCode(204)
  async trocarAtributos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { atributos } = validar(atributosSchema, corpo);
    await this.q(req, async (tx) => {
      const ok = await sql`select 1 from priv.produtos where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx);
      if (!ok.rows.length) throw new NotFoundException();
      await sql`delete from priv.produto_atributos where produto_id = ${id}::uuid and empresa_id = ${empresa}::uuid`.execute(tx);
      for (const a of atributos) {
        await sql`insert into priv.produto_atributos (produto_id, empresa_id, atributo_id, valor_numero, valor_texto, valor_booleano, unidade_id)
                  values (${id}::uuid, ${empresa}::uuid, ${a.atributoId}::uuid, ${a.valorNumero ?? null}::numeric, ${a.valorTexto ?? null}, ${a.valorBooleano ?? null}, ${a.unidadeId ?? null}::uuid)`.execute(tx);
      }
    });
  }

  // Fichas técnicas: histórico. A situação "vencida" é calculada na leitura (data em America/Sao_Paulo).
  @Permissao('produtos', 'visualizar')
  @Get('empresas/:empresa/produtos/:id/fichas')
  async fichas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select id, versao_ficha as "versaoFicha", fabricante, modelo, versao_produto as "versaoProduto", ano, data_emissao::text as "dataEmissao",
             fonte_oficial as "fonteOficial", valida_ate::text as "validaAte", modelo_id as "modeloId",
             case when situacao = 'vigente' and valida_ate < (now() at time zone 'America/Sao_Paulo')::date then 'vencida' else situacao end as situacao
        from priv.fichas_tecnicas where produto_id = ${id}::uuid and empresa_id = ${empresa}::uuid order by versao_ficha desc`.execute(tx)).rows);
  }

  @Permissao('produtos', 'cadastrar')
  @Post('empresas/:empresa/produtos/:id/fichas')
  async novaFicha(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(fichaSchema, corpo);
    return this.q(req, async (tx) => {
      const p = await sql`select 1 from priv.produtos where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null for update`.execute(tx);
      if (!p.rows.length) throw new NotFoundException();
      const v = (await sql<{ n: number }>`select coalesce(max(versao_ficha), 0) + 1 as n from priv.fichas_tecnicas where produto_id = ${id}::uuid`.execute(tx)).rows[0]?.n ?? 1;
      await sql`update priv.fichas_tecnicas set situacao = 'substituida' where produto_id = ${id}::uuid and empresa_id = ${empresa}::uuid and situacao = 'vigente'`.execute(tx);
      return (await sql<{ id: string }>`
        insert into priv.fichas_tecnicas (empresa_id, produto_id, modelo_id, versao_ficha, fabricante, modelo, versao_produto, ano, data_emissao, fonte_oficial, valida_ate)
        values (${empresa}::uuid, ${id}::uuid, ${d.modeloId ?? null}::uuid, ${v}, ${d.fabricante}, ${d.modelo}, ${d.versaoProduto ?? null}, ${d.ano ?? null},
                ${d.dataEmissao ?? null}::date, ${d.fonteOficial ?? null}, ${d.validaAte ?? null}::date) returning id`.execute(tx)).rows[0];
    });
  }

  // Só a situação muda (marcar descontinuada); o conteúdo nunca se reescreve.
  @Permissao('produtos', 'editar')
  @Patch('empresas/:empresa/fichas/:fid')
  async situacaoFicha(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('fid', new ParseUUIDPipe()) fid: string, @Body() corpo: unknown) {
    const { situacao } = validar(fichaEdicaoSchema, corpo);
    const r = await this.q(req, (tx) => sql`
      update priv.fichas_tecnicas set situacao = ${situacao} where id = ${fid}::uuid and empresa_id = ${empresa}::uuid and situacao <> 'substituida'`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
    return {};
  }
}
