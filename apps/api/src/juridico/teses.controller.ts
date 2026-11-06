import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { TIPO_XLSX, gerarXlsx } from '../exportacao/xlsx.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const criarSchema = z.object({ tipo: z.enum(['esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes']), titulo: z.string().trim().min(3).max(200), texto: z.string().trim().min(20).max(4000) }).strict();
const editarSchema = z.object({ titulo: z.string().trim().min(3).max(200), texto: z.string().trim().min(20).max(4000) }).strict();
const filtroSchema = z.object({ ano: z.coerce.number().int().min(2000).max(2100).optional() }).strict();

// Banco de teses e indicadores do jurídico (spec fase-10, 10.8/10.9). Toda escrita é por função do banco; o worker confere as citações da tese. Os
// indicadores são contagens diretas dos registros da empresa (nada estimado): taxa de deferimento = (deferido + parcialmente deferido) / peças respondidas.
@Controller()
export class TesesController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/teses')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select t.id, t.tipo_peca as tipo, t.titulo, t.texto, t.status, t.validacao, t.validada_em as "validadaEm", t.bloqueada, ua.nome as "aprovadaPor", t.aprovada_em as "aprovadaEm",
             count(pt.id)::int as usos,
             count(*) filter (where p.status = 'respondida')::int as respondidas,
             count(*) filter (where p.resultado in ('deferido', 'parcialmente_deferido'))::int as deferidas,
             count(*) filter (where p.resultado = 'indeferido')::int as indeferidas
        from priv.teses t left join core.usuarios ua on ua.id = t.aprovada_por left join priv.peca_teses pt on pt.tese_id = t.id left join priv.pecas p on p.id = pt.peca_id
       where t.empresa_id = ${empresa}::uuid and t.deleted_at is null
       group by t.id, ua.nome order by (t.status = 'aprovada') desc, t.created_at desc limit 300`.execute(tx)).rows);
  }

  // Teses aprovadas do mesmo tipo da peça, com a marca de quais já foram usadas nela.
  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/pecas/:id/teses')
  async dasPecas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select t.id, t.titulo, t.texto, exists (select 1 from priv.peca_teses pt where pt.peca_id = p.id and pt.tese_id = t.id) as usada
        from priv.pecas p join priv.teses t on t.empresa_id = p.empresa_id and t.tipo_peca = p.tipo and t.status = 'aprovada' and t.deleted_at is null
       where p.id = ${id}::uuid and p.empresa_id = ${empresa}::uuid order by t.aprovada_em desc limit 50`.execute(tx)).rows);
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/teses')
  @HttpCode(201)
  async criar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(criarSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.criar_tese(${empresa}::uuid, ${d.tipo}, ${d.titulo}, ${d.texto}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Put('empresas/:empresa/juridico/teses/:id')
  @HttpCode(204)
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(editarSchema, corpo);
    await this.q(req, (tx) => sql`select priv.editar_tese(${empresa}::uuid, ${id}::uuid, ${d.titulo}, ${d.texto})`.execute(tx));
  }

  @Permissao('juridico', 'aprovar_peca')
  @Post('empresas/:empresa/juridico/teses/:id/aprovar')
  @HttpCode(204)
  async aprovar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.aprovar_tese(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('juridico', 'aprovar_peca')
  @Post('empresas/:empresa/juridico/teses/:id/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.arquivar_tese(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/teses/:tese')
  @HttpCode(204)
  async usar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Param('tese', new ParseUUIDPipe()) tese: string) {
    await this.q(req, (tx) => sql`select priv.usar_tese(${empresa}::uuid, ${id}::uuid, ${tese}::uuid)`.execute(tx));
  }

  // 10.9 Indicadores: peças sugeridas, elaboradas e protocoladas; prazos cumpridos e perdidos; deferimento por tipo e por tese; licitações revertidas por recurso.
  private indicadoresDe(req: RequisicaoVV, empresa: string, consulta: unknown): Promise<Record<string, unknown>> {
    const f = validar(filtroSchema, consulta);
    const ano = f.ano ?? null;
    return this.q(req, async (tx) => {
      const geral = (await sql<Record<string, unknown>>`
        select (select count(*)::int from priv.sugestoes_pecas s where s.empresa_id = ${empresa}::uuid and (${ano}::int is null or extract(year from s.created_at) = ${ano}::int)) as sugeridas,
               count(*) filter (where p.status not in ('sugerida', 'descartada'))::int as elaboradas,
               count(*) filter (where p.status in ('protocolada', 'respondida'))::int as protocoladas,
               count(*) filter (where p.status = 'respondida')::int as respondidas,
               count(*) filter (where p.resultado in ('deferido', 'parcialmente_deferido'))::int as deferidas,
               count(*) filter (where p.resultado = 'indeferido')::int as indeferidas,
               count(*) filter (where p.tipo = 'recurso' and p.resultado in ('deferido', 'parcialmente_deferido'))::int as "revertidasPorRecurso",
               (select count(*)::int from priv.agenda_eventos ev where ev.empresa_id = ${empresa}::uuid and ev.tipo in ('esclarecimento', 'impugnacao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes')
                  and ev.status in ('protocolado', 'respondido') and (${ano}::int is null or extract(year from ev.data_limite_legal) = ${ano}::int)) as "prazosCumpridos",
               (select count(*)::int from priv.agenda_eventos ev where ev.empresa_id = ${empresa}::uuid and ev.tipo in ('esclarecimento', 'impugnacao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes')
                  and ev.status = 'prazo_perdido' and (${ano}::int is null or extract(year from ev.data_limite_legal) = ${ano}::int)) as "prazosPerdidos"
          from priv.pecas p where p.empresa_id = ${empresa}::uuid and (${ano}::int is null or extract(year from p.created_at) = ${ano}::int)`.execute(tx)).rows[0] ?? {};
      const porTipo = (await sql`
        select p.tipo, count(*) filter (where p.status not in ('sugerida', 'descartada'))::int as elaboradas, count(*) filter (where p.status in ('protocolada', 'respondida'))::int as protocoladas,
               count(*) filter (where p.status = 'respondida')::int as respondidas, count(*) filter (where p.resultado = 'deferido')::int as deferidas,
               count(*) filter (where p.resultado = 'parcialmente_deferido')::int as parciais, count(*) filter (where p.resultado = 'indeferido')::int as indeferidas,
               round(100.0 * count(*) filter (where p.resultado in ('deferido', 'parcialmente_deferido')) / nullif(count(*) filter (where p.status = 'respondida'), 0), 1)::text as taxa
          from priv.pecas p where p.empresa_id = ${empresa}::uuid and (${ano}::int is null or extract(year from p.created_at) = ${ano}::int)
         group by p.tipo order by p.tipo`.execute(tx)).rows;
      const porTese = (await sql`
        select t.id, t.titulo, t.tipo_peca as tipo, count(pt.id)::int as usos, count(*) filter (where p.status = 'respondida')::int as respondidas,
               count(*) filter (where p.resultado in ('deferido', 'parcialmente_deferido'))::int as deferidas, count(*) filter (where p.resultado = 'indeferido')::int as indeferidas,
               round(100.0 * count(*) filter (where p.resultado in ('deferido', 'parcialmente_deferido')) / nullif(count(*) filter (where p.status = 'respondida'), 0), 1)::text as taxa
          from priv.teses t join priv.peca_teses pt on pt.tese_id = t.id join priv.pecas p on p.id = pt.peca_id
         where t.empresa_id = ${empresa}::uuid and t.deleted_at is null and (${ano}::int is null or extract(year from p.created_at) = ${ano}::int)
         group by t.id order by count(pt.id) desc, t.titulo limit 30`.execute(tx)).rows;
      return { ano, ...geral, porTipo, porTese };
    });
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/indicadores')
  indicadores(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    return this.indicadoresDe(req, empresa, consulta);
  }

  // Exportação Excel (12.5) dos indicadores do jurídico: resumo, por tipo de peça e por tese.
  @Permissao('juridico', 'exportar')
  @Get('empresas/:empresa/juridico/indicadores.xlsx')
  async indicadoresXlsx(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const i = await this.indicadoresDe(req, empresa, consulta) as Record<string, number | string | null> & { porTipo: Record<string, string | number | null>[]; porTese: Record<string, string | number | null>[] };
    const ROTULO: Record<string, string> = { esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', recurso: 'Recurso administrativo', contrarrazoes: 'Contrarrazões', reajuste: 'Pedido de reajuste', reequilibrio: 'Pedido de reequilíbrio' };
    const n = (v: string | number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));
    const buf = gerarXlsx([
      { nome: 'Resumo', colunas: [{ titulo: 'Indicador', largura: 40 }, { titulo: 'Valor', tipo: 'numero' }], linhas: [
        ['Peças sugeridas', n(i.sugeridas)], ['Peças elaboradas', n(i.elaboradas)], ['Peças protocoladas', n(i.protocoladas)], ['Respondidas', n(i.respondidas)], ['Deferidas (total ou parcial)', n(i.deferidas)],
        ['Indeferidas', n(i.indeferidas)], ['Prazos cumpridos', n(i.prazosCumpridos)], ['Prazos perdidos', n(i.prazosPerdidos)], ['Licitações revertidas por recurso', n(i.revertidasPorRecurso)]] },
      { nome: 'Por tipo de peça', colunas: ['Tipo', 'Elaboradas', 'Protocoladas', 'Respondidas', 'Deferidas', 'Parciais', 'Indeferidas', 'Taxa de deferimento (%)'].map((titulo, k) => ({ titulo, tipo: k === 0 ? 'texto' as const : 'numero' as const })),
        linhas: i.porTipo.map((t) => [ROTULO[String(t.tipo)] ?? n(t.tipo), n(t.elaboradas), n(t.protocoladas), n(t.respondidas), n(t.deferidas), n(t.parciais), n(t.indeferidas), n(t.taxa)]) },
      { nome: 'Por tese', colunas: ['Tese', 'Tipo', 'Usos', 'Respondidas', 'Deferidas', 'Indeferidas', 'Taxa de deferimento (%)'].map((titulo, k) => ({ titulo, tipo: k > 1 ? 'numero' as const : 'texto' as const, largura: k === 0 ? 50 : 16 })),
        linhas: i.porTese.map((t) => [n(t.titulo), ROTULO[String(t.tipo)] ?? n(t.tipo), n(t.usos), n(t.respondidas), n(t.deferidas), n(t.indeferidas), n(t.taxa)]) },
    ]);
    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename="indicadores-juridico-vv-licitacoes.xlsx"');
    return new StreamableFile(buf);
  }
}
