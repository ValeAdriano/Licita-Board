import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));
const poderes = z.array(z.string().regex(/^[a-z_]{3,40}$/)).max(30);
const novaSchema = z.object({
  numero: z.string().trim().max(60).nullable().optional(), dataEmissao: data, dataValidade: data.nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(), poderes,
}).strict();
const edicaoSchema = z.object({
  numero: z.string().trim().max(60).nullable().optional(), dataEmissao: data.optional(), dataValidade: data.nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(), poderes: poderes.optional(),
}).strict();
const revogarSchema = z.object({ data }).strict();
const poderesSchema = z.object({ poderes }).strict();

// Poderes e procurações (spec fase-02 §3.2). A regra do signatário mora no banco (core.signatario_valido);
// a API só a expõe. ⚖️ Lista de poderes provisória (pub.poderes_representacao) até o jurídico VV.
@Controller()
export class ProcuracoesController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // Catálogo de poderes: não é dado de empresa (qualquer usuário autenticado).
  @Get('poderes')
  async catalogo(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select slug, nome, provisorio from pub.poderes_representacao order by ordem`.execute(tx)).rows);
  }

  @Permissao('representantes', 'visualizar')
  @Get('empresas/:empresa/representantes/:id/poderes')
  async poderesDe(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql<{ poder: string }>`
      select poder from core.representante_poderes where representante_id = ${id}::uuid and empresa_id = ${empresa}::uuid order by poder`.execute(tx)).rows.map((r) => r.poder));
  }

  // O conjunto enviado substitui o atual (poderes do sócio-administrador, pelo contrato social).
  @Permissao('representantes', 'editar')
  @Put('empresas/:empresa/representantes/:id/poderes')
  @HttpCode(204)
  async trocarPoderes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { poderes: novos } = validar(poderesSchema, corpo);
    const lista = [...new Set(novos)];
    await this.q(req, async (tx) => {
      const ok = await sql`select 1 from core.representantes where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx);
      if (!ok.rows.length) throw new NotFoundException();
      await sql`delete from core.representante_poderes where representante_id = ${id}::uuid and empresa_id = ${empresa}::uuid`.execute(tx);
      if (lista.length) {
        await sql`insert into core.representante_poderes (representante_id, empresa_id, poder)
                  select ${id}::uuid, ${empresa}::uuid, p from unnest(${lista}::text[]) p`.execute(tx);
      }
    });
  }

  @Permissao('representantes', 'visualizar')
  @Get('empresas/:empresa/representantes/:id/procuracoes')
  async procuracoes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select p.id, p.numero, p.data_emissao::text as "dataEmissao", p.data_validade::text as "dataValidade",
             p.revogada_em::text as "revogadaEm", p.observacao,
             coalesce(array_agg(pp.poder order by pp.poder) filter (where pp.poder is not null), '{}') as poderes
        from core.procuracoes p left join core.procuracao_poderes pp on pp.procuracao_id = p.id
       where p.representante_id = ${id}::uuid and p.empresa_id = ${empresa}::uuid and p.deleted_at is null
       group by p.id order by p.data_emissao desc`.execute(tx)).rows);
  }

  @Permissao('representantes', 'cadastrar')
  @Post('empresas/:empresa/representantes/:id/procuracoes')
  async nova(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(novaSchema, corpo);
    const lista = [...new Set(d.poderes)];
    return this.q(req, async (tx) => {
      // Representante ausente ou de outra empresa é 404, não o 400 genérico da FK (representante_id, empresa_id). Mesmo
      // filtro da FK (sem deleted_at); o insert com returning já exige representantes/visualizar pela RLS de leitura.
      const rep = await sql`select 1 from core.representantes where id = ${id}::uuid and empresa_id = ${empresa}::uuid`.execute(tx);
      if (!rep.rows.length) throw new NotFoundException();
      const p = (await sql<{ id: string }>`
        insert into core.procuracoes (empresa_id, representante_id, numero, data_emissao, data_validade, observacao)
        values (${empresa}::uuid, ${id}::uuid, ${d.numero ?? null}, ${d.dataEmissao}::date, ${d.dataValidade ?? null}::date, ${d.observacao ?? null})
        returning id`.execute(tx)).rows[0];
      if (p && lista.length) {
        await sql`insert into core.procuracao_poderes (procuracao_id, empresa_id, poder)
                  select ${p.id}::uuid, ${empresa}::uuid, x from unnest(${lista}::text[]) x`.execute(tx);
      }
      return p;
    });
  }

  @Permissao('representantes', 'editar')
  @Patch('empresas/:empresa/procuracoes/:pid')
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('pid', new ParseUUIDPipe()) pid: string, @Body() corpo: unknown) {
    const d = validar(edicaoSchema, corpo);
    await this.q(req, async (tx) => {
      const r = await sql`
        update core.procuracoes
           set numero = case when ${d.numero !== undefined} then ${d.numero ?? null} else numero end,
               data_emissao = coalesce(${d.dataEmissao ?? null}::date, data_emissao),
               data_validade = case when ${d.dataValidade !== undefined} then ${d.dataValidade ?? null}::date else data_validade end,
               observacao = case when ${d.observacao !== undefined} then ${d.observacao ?? null} else observacao end
         where id = ${pid}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx);
      if (!r.numAffectedRows) throw new NotFoundException();
      if (d.poderes) {
        const lista = [...new Set(d.poderes)];
        await sql`delete from core.procuracao_poderes where procuracao_id = ${pid}::uuid and empresa_id = ${empresa}::uuid`.execute(tx);
        if (lista.length) {
          await sql`insert into core.procuracao_poderes (procuracao_id, empresa_id, poder)
                    select ${pid}::uuid, ${empresa}::uuid, x from unnest(${lista}::text[]) x`.execute(tx);
        }
      }
    });
    return {};
  }

  // Revogar não apaga: a procuração deixa de valer a partir da data (a anterior continua valendo).
  @Permissao('representantes', 'editar')
  @Post('empresas/:empresa/procuracoes/:pid/revogar')
  @HttpCode(204)
  async revogar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('pid', new ParseUUIDPipe()) pid: string, @Body() corpo: unknown) {
    const { data: d } = validar(revogarSchema, corpo);
    const r = await this.q(req, (tx) => sql`
      update core.procuracoes set revogada_em = ${d}::date where id = ${pid}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  @Permissao('representantes', 'arquivar')
  @Post('empresas/:empresa/procuracoes/:pid/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('pid', new ParseUUIDPipe()) pid: string) {
    const r = await this.q(req, (tx) => sql`
      update core.procuracoes set deleted_at = now() where id = ${pid}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  // O signatário vale nesta data para este poder? (a mesma regra que a geração de documentos usará)
  @Permissao('representantes', 'visualizar')
  @Get('empresas/:empresa/representantes/:id/signatario-valido')
  async signatarioValido(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string,
    @Query('data') d: unknown, @Query('poder') poder: unknown) {
    const dia = validar(data, d);
    const p = validar(z.string().regex(/^[a-z_]{3,40}$/), poder);
    const r = await this.q(req, async (tx) => (await sql<{ v: boolean }>`
      select core.signatario_valido(r.id, ${dia}::date, ${p}) as v
        from core.representantes r where r.id = ${id}::uuid and r.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0]);
    if (!r) throw new NotFoundException();
    return { valido: r.v };
  }
}
