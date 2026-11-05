import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const recursoSchema = z.object({
  recorrente: z.string().trim().min(2).max(200), publicadoEm: z.iso.datetime({ offset: true }),
  texto: z.string().trim().min(50).max(60000), link: z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use um link https.').nullable().optional(),
}).strict();
const alegacaoSchema = z.object({ resumo: z.string().trim().min(3).max(600), citacao: z.string().trim().max(1500).nullable().optional() }).strict();
const decisaoSchema = z.object({
  decisao: z.enum(['rebater', 'concordar', 'sem_relevancia']), contraProva: z.string().trim().max(1000).nullable().optional(), fundamento: z.string().trim().max(1000).nullable().optional(),
}).strict();
const filtroSchema = z.object({ acompanhamento: z.uuid().optional() }).strict();

// Recurso de terceiro (spec fase-10, 10.6). A API só grava por função do banco: inserir o recurso lança o prazo de contrarrazões na agenda,
// abre a peça e enfileira a leitura; o worker (IA) extrai as alegações. A defesa de cada alegação é decisão humana. Nunca protocola (regra 17).
@Controller()
export class RecursosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/recursos')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(filtroSchema, consulta);
    return this.q(req, async (tx) => (await sql`
      select r.id, r.recorrente, r.publicado_em as "publicadoEm", r.peca_id as "pecaId", r.leitura_status as "leituraStatus", r.acompanhamento_id as "acompanhamentoId",
             (select count(*)::int from priv.recurso_alegacoes a where a.recurso_id = r.id) as alegacoes,
             (select count(*)::int from priv.recurso_alegacoes a where a.recurso_id = r.id and a.risco) as riscos
        from priv.recursos_terceiros r where r.empresa_id = ${empresa}::uuid and (${f.acompanhamento ?? null}::uuid is null or r.acompanhamento_id = ${f.acompanhamento ?? null}::uuid)
       order by r.created_at desc limit 200`.execute(tx)).rows);
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/recursos/:id')
  async detalhe(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const rec = (await sql`
        select r.id, r.recorrente, r.publicado_em as "publicadoEm", r.link, r.texto, r.peca_id as "pecaId", r.leitura_status as "leituraStatus", r.leitura_erro as "leituraErro",
               r.leitura_modelo as "leituraModelo", r.leitura_em as "leituraEm", ev.data_limite_legal as "prazoLegal", ev.data_interna_recomendada as "prazoInterno"
          from priv.recursos_terceiros r join priv.pecas p on p.id = r.peca_id left join priv.agenda_eventos ev on ev.id = p.evento_id
         where r.id = ${id}::uuid and r.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0];
      if (!rec) return null;
      const alegacoes = (await sql`
        select id, ordem, origem, resumo, citacao, citacao_confere as "citacaoConfere", fundamentos, decisao, contra_prova as "contraProva", fundamento_refutacao as fundamento, risco
          from priv.recurso_alegacoes where recurso_id = ${id}::uuid and empresa_id = ${empresa}::uuid order by ordem`.execute(tx)).rows;
      return { ...rec, alegacoes };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/acompanhamentos/:id/recursos')
  @HttpCode(201)
  async inserir(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(recursoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ r: { id: string; pecaId: string; eventoId: string } }>`
      select priv.inserir_recurso_terceiro(${empresa}::uuid, ${id}::uuid, ${d.recorrente}, ${d.publicadoEm}::timestamptz, ${d.texto}, ${d.link ?? null}) as r`.execute(tx));
    return r.rows[0]?.r;
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/recursos/:id/ler')
  @HttpCode(202)
  async ler(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.pedir_leitura_recurso(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'pendente' };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/recursos/:id/alegacoes')
  @HttpCode(201)
  async adicionar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(alegacaoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.adicionar_alegacao(${empresa}::uuid, ${id}::uuid, ${d.resumo}, ${d.citacao ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Put('empresas/:empresa/juridico/alegacoes/:id')
  @HttpCode(204)
  async decidir(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(decisaoSchema, corpo);
    await this.q(req, (tx) => sql`select priv.decidir_alegacao(${empresa}::uuid, ${id}::uuid, ${d.decisao}, ${d.contraProva ?? null}, ${d.fundamento ?? null})`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Delete('empresas/:empresa/juridico/alegacoes/:id')
  @HttpCode(204)
  async remover(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.remover_alegacao(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }
}
