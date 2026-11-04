import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const slug = z.string().regex(/^[a-z0-9_]{2,60}$/);
const decimal = z.string().regex(/^\d{1,18}(\.\d{1,12})?$/);
const unidadeSchema = z.object({
  simbolo: z.string().trim().min(1).max(12), nome: z.string().trim().min(1).max(80), grandeza: z.string().regex(/^[a-z_]{3,30}$/),
  fatorParaBase: decimal, deslocamento: z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/).optional(), base: z.boolean().optional(),
}).strict();
const categoriaSchema = z.object({ slug, nome: z.string().trim().min(2).max(120), paiId: z.uuid().nullable().optional(), ordem: z.number().int().optional() }).strict();
const atributoSchema = z.object({
  categoriaId: z.uuid(), slug, nome: z.string().trim().min(2).max(120), tipo: z.enum(['numero', 'texto', 'lista', 'booleano']),
  grandeza: z.string().regex(/^[a-z_]{3,30}$/).nullable().optional(), unidadePadraoId: z.uuid().nullable().optional(),
  opcoes: z.array(z.string().trim().min(1).max(80)).min(1).max(100).nullable().optional(), obrigatorio: z.boolean().optional(), ordem: z.number().int().optional(),
}).strict();
const modeloSchema = z.object({
  categoriaId: z.uuid(), fabricante: z.string().trim().min(1).max(120), marca: z.string().trim().max(120).nullable().optional(),
  modelo: z.string().trim().min(1).max(120), versao: z.string().trim().max(120).nullable().optional(), anoModelo: z.number().int().min(1900).max(2100).nullable().optional(),
}).strict();
export const valorAtributoSchema = z.object({
  atributoId: z.uuid(), valorNumero: decimal.nullable().optional(), valorTexto: z.string().trim().max(500).nullable().optional(),
  valorBooleano: z.boolean().nullable().optional(), unidadeId: z.uuid().nullable().optional(),
}).strict();
const atributosSchema = z.object({ atributos: z.array(valorAtributoSchema).max(200) }).strict();

// Catálogo (pub): leitura para qualquer usuário autenticado; escrita só de SUPERADMIN (a RLS do banco
// recusa os demais com 403). Atributo novo é uma linha nova: sem migration (spec fase-02, CA-2).
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Get('unidades')
  unidades(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, simbolo, nome, grandeza, fator_para_base::text as "fatorParaBase", base from pub.unidades order by grandeza, fator_para_base`.execute(tx)).rows);
  }

  @Get('categorias')
  categorias(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, slug, nome, pai_id as "paiId" from pub.categorias order by ordem, nome`.execute(tx)).rows);
  }

  @Get('atributos')
  atributos(@Req() req: RequisicaoVV, @Query('categoria') categoria: unknown) {
    const c = validar(z.uuid(), categoria);
    return this.q(req, async (tx) => (await sql`
      select a.id, a.slug, a.nome, a.tipo, a.grandeza, a.unidade_padrao_id as "unidadePadraoId", u.simbolo as "unidadePadrao",
             a.opcoes, a.obrigatorio
        from pub.atributos_def a left join pub.unidades u on u.id = a.unidade_padrao_id
       where a.categoria_id = ${c}::uuid or a.categoria_id = (select pai_id from pub.categorias where id = ${c}::uuid)
       order by a.ordem, a.nome`.execute(tx)).rows);
  }

  @Get('modelos')
  modelos(@Req() req: RequisicaoVV, @Query('categoria') categoria: unknown, @Query('q') q: unknown) {
    const c = categoria === undefined ? null : validar(z.uuid(), categoria);
    const busca = q === undefined ? null : validar(z.string().trim().min(1).max(80), q);
    return this.q(req, async (tx) => (await sql`
      select id, categoria_id as "categoriaId", fabricante, marca, modelo, versao, ano_modelo as "anoModelo", descontinuado_em::text as "descontinuadoEm"
        from pub.modelos
       where (${c}::uuid is null or categoria_id = ${c}::uuid)
         and (${busca}::text is null or fabricante ilike '%' || ${busca} || '%' or modelo ilike '%' || ${busca} || '%')
       order by fabricante, modelo limit 200`.execute(tx)).rows);
  }

  @Get('modelos/:id/atributos')
  async atributosDoModelo(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select atributo_id as "atributoId", valor_numero::text as "valorNumero", valor_texto as "valorTexto", valor_booleano as "valorBooleano", unidade_id as "unidadeId"
        from pub.modelo_atributos where modelo_id = ${id}::uuid`.execute(tx)).rows);
  }

  // Conversão exata (numeric no banco, string no JSON).
  @Get('converter')
  async converter(@Req() req: RequisicaoVV, @Query('valor') valor: unknown, @Query('de') de: unknown, @Query('para') para: unknown) {
    const v = validar(z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/), valor);
    const a = validar(z.string().min(1).max(12), de);
    const b = validar(z.string().min(1).max(12), para);
    return this.q(req, async (tx) => ({
      valor: (await sql<{ r: string }>`select pub.converter(${v}::numeric, ${a}, ${b})::text as r`.execute(tx)).rows[0]?.r,
    }));
  }

  @Post('unidades')
  async novaUnidade(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(unidadeSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into pub.unidades (simbolo, nome, grandeza, fator_para_base, deslocamento, base)
      values (${d.simbolo}, ${d.nome}, ${d.grandeza}, ${d.fatorParaBase}::numeric, ${d.deslocamento ?? '0'}::numeric, ${d.base ?? false}) returning id`.execute(tx)).rows[0]);
  }

  @Post('categorias')
  async novaCategoria(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(categoriaSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into pub.categorias (slug, nome, pai_id, ordem) values (${d.slug}, ${d.nome}, ${d.paiId ?? null}::uuid, ${d.ordem ?? 0}) returning id`.execute(tx)).rows[0]);
  }

  @Post('atributos')
  async novoAtributo(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(atributoSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into pub.atributos_def (categoria_id, slug, nome, tipo, grandeza, unidade_padrao_id, opcoes, obrigatorio, ordem)
      values (${d.categoriaId}::uuid, ${d.slug}, ${d.nome}, ${d.tipo}, ${d.grandeza ?? null}, ${d.unidadePadraoId ?? null}::uuid,
              ${d.opcoes ? JSON.stringify(d.opcoes) : null}::jsonb, ${d.obrigatorio ?? false}, ${d.ordem ?? 0}) returning id`.execute(tx)).rows[0]);
  }

  @Post('modelos')
  async novoModelo(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(modeloSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into pub.modelos (categoria_id, fabricante, marca, modelo, versao, ano_modelo)
      values (${d.categoriaId}::uuid, ${d.fabricante}, ${d.marca ?? null}, ${d.modelo}, ${d.versao ?? null}, ${d.anoModelo ?? null}) returning id`.execute(tx)).rows[0]);
  }

  // O conjunto enviado substitui os atributos do modelo (validados pelo tipo no banco).
  @Put('modelos/:id/atributos')
  @HttpCode(204)
  async trocarAtributos(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { atributos } = validar(atributosSchema, corpo);
    await this.q(req, async (tx) => {
      const ok = await sql`select 1 from pub.modelos where id = ${id}::uuid`.execute(tx);
      if (!ok.rows.length) throw new NotFoundException();
      await sql`delete from pub.modelo_atributos where modelo_id = ${id}::uuid`.execute(tx);
      for (const a of atributos) {
        await sql`insert into pub.modelo_atributos (modelo_id, atributo_id, valor_numero, valor_texto, valor_booleano, unidade_id)
                  values (${id}::uuid, ${a.atributoId}::uuid, ${a.valorNumero ?? null}::numeric, ${a.valorTexto ?? null}, ${a.valorBooleano ?? null}, ${a.unidadeId ?? null}::uuid)`.execute(tx);
      }
    });
  }
}
