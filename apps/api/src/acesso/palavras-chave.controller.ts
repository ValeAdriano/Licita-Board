import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
// Minúsculas, sem acento e sem espaço repetido: duas grafias do mesmo termo não duplicam.
export const normalizarTermo = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const termoSchema = z.object({
  tipo: z.enum(['palavra', 'sinonimo', 'categoria', 'marca', 'modelo', 'relacionado', 'exclusao']), termo: z.string().trim().min(1).max(120), grupoId: z.uuid().nullable().optional(),
}).strict();
const termoEdicaoSchema = z.object({ termo: z.string().trim().min(1).max(120).optional(), ativo: z.boolean().optional() }).strict();
const dinheiro = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const filtroSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('uf'), uf: z.enum(UFS) }).strict(),
  z.object({ tipo: z.literal('municipio'), uf: z.enum(UFS), municipio: z.string().trim().min(1).max(100) }).strict(),
  z.object({ tipo: z.literal('faixa_valor'), valorMin: dinheiro.optional(), valorMax: dinheiro.optional() }).strict(),
  z.object({ tipo: z.literal('restricao'), texto: z.string().trim().min(1).max(300) }).strict(),
]);

// Palavras-chave e filtros por empresa (Prompt 2.5): só cadastro. Termos de exclusão apenas REDUZEM a nota
// (Fase 04); nunca eliminam oportunidade.
@Controller()
export class PalavrasChaveController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('produtos', 'visualizar')
  @Get('empresas/:empresa/palavras-chave')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => ({
      termos: (await sql`select id, tipo, termo, grupo_id as "grupoId", ativo from priv.palavras_chave
                          where empresa_id = ${empresa}::uuid and deleted_at is null order by tipo, termo_normalizado`.execute(tx)).rows,
      filtros: (await sql`select id, tipo, uf, municipio, valor_min::text as "valorMin", valor_max::text as "valorMax", texto from priv.palavras_chave_filtros
                           where empresa_id = ${empresa}::uuid and deleted_at is null order by tipo, uf, municipio`.execute(tx)).rows,
    }));
  }

  @Permissao('produtos', 'cadastrar')
  @Post('empresas/:empresa/palavras-chave')
  async novo(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(termoSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into priv.palavras_chave (empresa_id, tipo, termo, termo_normalizado, grupo_id)
      values (${empresa}::uuid, ${d.tipo}, ${d.termo}, ${normalizarTermo(d.termo)}, ${d.grupoId ?? null}::uuid) returning id`.execute(tx)).rows[0]);
  }

  @Permissao('produtos', 'editar')
  @Patch('empresas/:empresa/palavras-chave/:id')
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(termoEdicaoSchema, corpo);
    const r = await this.q(req, (tx) => sql`
      update priv.palavras_chave
         set termo = coalesce(${d.termo ?? null}, termo), termo_normalizado = coalesce(${d.termo ? normalizarTermo(d.termo) : null}, termo_normalizado),
             ativo = coalesce(${d.ativo ?? null}, ativo)
       where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
    return {};
  }

  @Permissao('produtos', 'arquivar')
  @Post('empresas/:empresa/palavras-chave/:id/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update priv.palavras_chave set deleted_at = now() where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  @Permissao('produtos', 'cadastrar')
  @Post('empresas/:empresa/palavras-chave-filtros')
  async novoFiltro(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(filtroSchema, corpo);
    const uf = 'uf' in d ? d.uf : null;
    const municipio = d.tipo === 'municipio' ? d.municipio : null;
    const vmin = d.tipo === 'faixa_valor' ? (d.valorMin ?? null) : null;
    const vmax = d.tipo === 'faixa_valor' ? (d.valorMax ?? null) : null;
    const txt = d.tipo === 'restricao' ? d.texto : null;
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into priv.palavras_chave_filtros (empresa_id, tipo, uf, municipio, valor_min, valor_max, texto)
      values (${empresa}::uuid, ${d.tipo}, ${uf}, ${municipio}, ${vmin}::numeric, ${vmax}::numeric, ${txt}) returning id`.execute(tx)).rows[0]);
  }

  @Permissao('produtos', 'arquivar')
  @Post('empresas/:empresa/palavras-chave-filtros/:id/arquivar')
  @HttpCode(204)
  async arquivarFiltro(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update priv.palavras_chave_filtros set deleted_at = now() where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }
}
