import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const FINAIS = ['arrematada', 'adjudicada', 'homologada', 'contratada', 'perdida', 'inabilitada', 'desclassificada', 'fracassada', 'deserta', 'revogada', 'anulada', 'cancelada'] as const;
const TIPOS_DOC_POSTERIOR = ['ata_sessao', 'habilitacao_propria', 'habilitacao_vencedora', 'decisao', 'adjudicacao', 'homologacao', 'ata_registro_precos', 'contrato', 'empenho', 'recurso_terceiro', 'contrarrazoes_terceiro', 'outro'] as const;
const SUBTIPOS_DECISAO = ['recurso', 'impugnacao', 'esclarecimento', 'habilitacao', 'outra'] as const;
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Data inválida.');
// Dinheiro como string decimal (regra 14); o banco guarda numeric(18,4).
const dinheiro = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const resultadoSchema = z.object({
  resultado: z.enum(FINAIS), valorInicial: dinheiro.nullable().optional(), valorFinal: dinheiro.nullable().optional(), classificacao: z.number().int().min(1).max(10000).nullable().optional(),
  melhorLance: dinheiro.nullable().optional(), vencedoraCnpj: z.string().trim().max(30).nullable().optional(), vencedoraNome: z.string().trim().max(200).nullable().optional(),
  vencedoraMarcaModelo: z.string().trim().max(200).nullable().optional(), motivo: z.string().trim().max(1000).nullable().optional(),
  habilitacao: z.enum(['a_confirmar', 'em_analise', 'habilitada', 'inabilitada']).default('a_confirmar'), ocorridoEm: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();
const filtroSchema = z.object({
  q: z.string().trim().max(100).optional(), status: z.string().max(200).optional(), ano: z.coerce.number().int().min(2000).max(2100).optional(),
  orgao: z.string().trim().max(100).optional(), marca: z.string().trim().max(100).optional(),
}).strict();
const filtroDocPosteriorSchema = z.object({
  tipo: z.string().trim().max(60).optional(),
  participacao: z.uuid().optional(),
}).strict();
const docPosteriorSchema = z.object({
  tipo: z.enum(TIPOS_DOC_POSTERIOR),
  subtipo: z.enum(SUBTIPOS_DECISAO).nullable().optional(),
  dataAto: dia,
  numero: z.string().trim().max(80).nullable().optional(),
  participacaoId: z.uuid().nullable().optional(),
  documentoId: z.uuid().nullable().optional(),
  link: z.string().trim().max(500).regex(/^https:\/\/[^\s]+$/).nullable().optional(),
  concorrenteCnpj: z.string().trim().regex(/^[0-9A-Z]{14}$/).nullable().optional(),
  recursoTerceiroId: z.uuid().nullable().optional(),
  observacao: z.string().trim().max(1000).nullable().optional(),
}).strict();
const habilitacaoApresentadaSchema = z.object({ dataAto: dia }).strict();
const removerDocPosteriorSchema = z.object({ motivo: z.string().trim().min(5).max(500) }).strict();

interface ItemLinhaTempo {
  origem: 'registro' | 'proposta' | 'envio_proposta' | 'peca' | 'recurso_terceiro' | 'parecer' | 'contrato' | 'empenho' | 'anexo_contrato';
  id: string;
  tipo: string;
  subtipo: string | null;
  titulo: string;
  dataAto: string;
  numero: string | null;
  participacaoId: string | null;
  concorrenteCnpj: string | null;
  observacao: string | null;
  link: string | null;
  documento: { id: string; versaoId: string | null; nome: string; status: string | null } | null;
  refRota: string | null;
}

// Resultados das disputas (spec fase-09). Só REGISTRO: o sistema nunca dá lance nem protocola (regra 17). Perder, ser inabilitada ou
// desclassificada abre a intenção de recurso na agenda (o banco chama o fato; o worker calcula o prazo).
@Controller()
export class ResultadosController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/participacoes/:id/resultado')
  async obter(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => (await sql`
      select r.id, r.resultado_final as resultado, r.valor_inicial::text as "valorInicial", r.valor_final::text as "valorFinal", r.classificacao, r.melhor_lance::text as "melhorLance",
             r.vencedora_cnpj as "vencedoraCnpj", r.vencedora_nome as "vencedoraNome", r.vencedora_marca_modelo as "vencedoraMarcaModelo", r.motivo_perda as motivo,
             r.situacao_habilitacao as habilitacao, r.ocorrido_em as "ocorridoEm", r.gatilho_recursal as "gatilhoRecursal"
        from priv.resultados_item r where r.participacao_id = ${id}::uuid and r.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0]);
    return r ?? null;
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/participacoes/:id/resultado')
  @HttpCode(200)
  async registrar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(resultadoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.registrar_resultado(${empresa}::uuid, ${id}::uuid, ${d.resultado}, ${d.valorInicial ?? null}::numeric, ${d.valorFinal ?? null}::numeric, ${d.classificacao ?? null}::int,
        ${d.melhorLance ?? null}::numeric, ${d.vencedoraCnpj ?? null}, ${d.vencedoraNome ?? null}, ${d.vencedoraMarcaModelo ?? null}, ${d.motivo ?? null}, ${d.habilitacao},
        ${d.ocorridoEm ?? null}::timestamptz) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  // Histórico pesquisável (9.4): por texto (órgão, objeto, edital, processo, vencedora, marca, modelo), situação, ano, órgão e marca.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/resultados')
  historico(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(filtroSchema, consulta);
    const status = f.status ? f.status.split(',').filter((s) => (FINAIS as readonly string[]).includes(s)) : null;
    const like = (t?: string) => (t ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);
    return this.q(req, async (tx) => (await sql`
      select r.id, r.participacao_id as "participacaoId", a.id as "acompanhamentoId", r.resultado_final as resultado, r.valor_inicial::text as "valorInicial", r.valor_final::text as "valorFinal",
             r.classificacao, r.melhor_lance::text as "melhorLance", r.vencedora_nome as "vencedoraNome", r.vencedora_cnpj as "vencedoraCnpj", r.vencedora_marca_modelo as "vencedoraMarcaModelo",
             r.motivo_perda as motivo, r.situacao_habilitacao as habilitacao, r.ocorrido_em as "ocorridoEm", r.gatilho_recursal as "gatilhoRecursal",
             i.numero_item as "numeroItem", left(i.descricao, 200) as item, e.numero_edital as "numeroEdital", e.processo, left(e.objeto, 200) as objeto, g.razao_social as orgao, g.uf, g.municipio,
             pa.marca, pa.modelo
        from priv.resultados_item r join priv.participacoes pa on pa.id = r.participacao_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id
        left join pub.edital_itens i on i.id = pa.item_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
       where r.empresa_id = ${empresa}::uuid
         and (${status}::text[] is null or r.resultado_final = any (${status}::text[]))
         and (${f.ano ?? null}::int is null or extract(year from r.ocorrido_em at time zone 'America/Sao_Paulo') = ${f.ano ?? null}::int)
         and (${like(f.orgao)}::text is null or g.razao_social ilike ${like(f.orgao)}::text escape '\\' or g.municipio ilike ${like(f.orgao)}::text escape '\\')
         and (${like(f.marca)}::text is null or pa.marca ilike ${like(f.marca)}::text escape '\\' or pa.modelo ilike ${like(f.marca)}::text escape '\\' or r.vencedora_marca_modelo ilike ${like(f.marca)}::text escape '\\')
         and (${like(f.q)}::text is null or g.razao_social ilike ${like(f.q)}::text escape '\\' or e.objeto ilike ${like(f.q)}::text escape '\\' or e.numero_edital ilike ${like(f.q)}::text escape '\\'
              or e.processo ilike ${like(f.q)}::text escape '\\' or r.vencedora_nome ilike ${like(f.q)}::text escape '\\' or pa.marca ilike ${like(f.q)}::text escape '\\'
              or pa.modelo ilike ${like(f.q)}::text escape '\\' or i.descricao ilike ${like(f.q)}::text escape '\\')
       order by r.ocorrido_em desc limit 200`.execute(tx)).rows);
  }

  // Documentos posteriores à disputa (9.5): linha do tempo unificada sem duplicar registros de outros módulos.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/acompanhamentos/:id/documentos-posteriores')
  async documentosPosteriores(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Query() consulta: unknown) {
    const f = validar(filtroDocPosteriorSchema, consulta);
    const r = await this.q(req, async (tx) => {
      const ac = (await sql<{
        id: string;
        vePropostas: boolean;
        veJuridico: boolean;
        veContratos: boolean;
      }>`
        select a.id,
               core.has_permission(a.empresa_id, 'propostas', 'visualizar') as "vePropostas",
               core.has_permission(a.empresa_id, 'juridico', 'visualizar') as "veJuridico",
               core.has_permission(a.empresa_id, 'contratos', 'visualizar') as "veContratos"
          from priv.acompanhamentos a
         where a.id = ${id}::uuid and a.empresa_id = ${empresa}::uuid and a.deleted_at is null`.execute(tx)).rows[0];
      if (!ac) return null;

      const registros = (await sql<ItemLinhaTempo>`
        select 'registro'::text as origem, dp.id, dp.tipo, dp.subtipo,
               coalesce(d.descricao, dp.observacao, dp.numero, dp.tipo) as titulo,
               dp.data_ato::text as "dataAto", dp.numero, dp.participacao_id as "participacaoId",
               dp.concorrente_cnpj as "concorrenteCnpj", dp.observacao, dp.link_publico as link,
               case when d.id is not null then jsonb_build_object(
                 'id', d.id,
                 'versaoId', coalesce(dp.documento_versao_id, s.versao_id),
                 'nome', coalesce(v.nome_original, d.descricao),
                 'status', coalesce(v.status_arquivo, s.status)
               ) else null end as documento,
               case when dp.recurso_terceiro_id is not null then '/juridico' else null end as "refRota"
          from priv.documentos_posteriores dp
          left join priv.documentos d on d.id = dp.documento_id
          left join priv.documento_versoes v on v.id = dp.documento_versao_id
          left join priv.documentos_status s on s.documento_id = d.id
         where dp.acompanhamento_id = ${id}::uuid and dp.empresa_id = ${empresa}::uuid and dp.deleted_at is null`.execute(tx)).rows;

      const propostas = ac.vePropostas ? (await sql<ItemLinhaTempo>`
        select 'proposta'::text as origem, p.id, 'proposta_final'::text as tipo, p.tipo as subtipo,
               ('Proposta v' || p.versao || ' (' || p.tipo || ')') as titulo,
               (coalesce(p.gerado_em, p.updated_at, p.created_at) at time zone 'America/Sao_Paulo')::date::text as "dataAto",
               ('v' || p.versao::text) as numero, null::uuid as "participacaoId",
               null::text as "concorrenteCnpj", null::text as observacao, null::text as link,
               null::jsonb as documento,
               ('/agenda/acompanhamentos/' || p.acompanhamento_id || '/propostas') as "refRota"
          from priv.propostas p
         where p.acompanhamento_id = ${id}::uuid and p.empresa_id = ${empresa}::uuid
           and p.status = 'final' and p.deleted_at is null
        union all
        select 'envio_proposta'::text as origem, pe.id, 'envio_proposta'::text as tipo, pe.portal as subtipo,
               ('Envio da proposta v' || p.versao || coalesce(' · ' || pe.portal, '')) as titulo,
               (pe.enviado_em at time zone 'America/Sao_Paulo')::date::text as "dataAto",
               pe.identificador_portal as numero, null::uuid as "participacaoId",
               null::text as "concorrenteCnpj", pe.observacao, null::text as link,
               case when d.id is not null then jsonb_build_object(
                 'id', d.id, 'versaoId', coalesce(pe.comprovante_versao_id, s.versao_id), 'nome', d.descricao, 'status', s.status
               ) else null end as documento,
               ('/agenda/acompanhamentos/' || p.acompanhamento_id || '/propostas') as "refRota"
          from priv.proposta_envios pe
          join priv.propostas p on p.id = pe.proposta_id and p.empresa_id = pe.empresa_id
          left join priv.documentos d on d.id = pe.comprovante_documento_id
          left join priv.documentos_status s on s.documento_id = d.id
         where p.acompanhamento_id = ${id}::uuid and pe.empresa_id = ${empresa}::uuid
           and pe.anulado_em is null and p.deleted_at is null`.execute(tx)).rows : [];

      const juridico = ac.veJuridico ? (await sql<ItemLinhaTempo>`
        select 'peca'::text as origem, pe.id, pe.tipo, pe.status as subtipo,
               pe.titulo,
               (coalesce(pe.protocolado_em, pe.gerado_em, pe.created_at) at time zone 'America/Sao_Paulo')::date::text as "dataAto",
               pe.protocolo_numero as numero, null::uuid as "participacaoId",
               null::text as "concorrenteCnpj", pe.resultado_obs as observacao, null::text as link,
               null::jsonb as documento,
               '/juridico'::text as "refRota"
          from priv.pecas pe
         where pe.acompanhamento_id = ${id}::uuid and pe.empresa_id = ${empresa}::uuid
        union all
        select 'recurso_terceiro'::text as origem, rt.id, 'recurso_terceiro'::text as tipo, null::text as subtipo,
               ('Recurso de terceiro · ' || rt.recorrente) as titulo,
               (rt.publicado_em at time zone 'America/Sao_Paulo')::date::text as "dataAto",
               null::text as numero, null::uuid as "participacaoId",
               null::text as "concorrenteCnpj", null::text as observacao, rt.link,
               null::jsonb as documento,
               '/juridico'::text as "refRota"
          from priv.recursos_terceiros rt
         where rt.acompanhamento_id = ${id}::uuid and rt.empresa_id = ${empresa}::uuid
        union all
        select 'parecer'::text as origem, pr.id, 'parecer'::text as tipo, pr.recomendacao as subtipo,
               ('Parecer recursal · ' || pr.concorrente) as titulo,
               (coalesce(pr.recomendada_em, pr.updated_at, pr.created_at) at time zone 'America/Sao_Paulo')::date::text as "dataAto",
               null::text as numero, pr.participacao_id as "participacaoId",
               null::text as "concorrenteCnpj", pr.recomendacao_justificativa as observacao, null::text as link,
               null::jsonb as documento,
               '/juridico'::text as "refRota"
          from priv.pareceres_recursais pr
          join priv.participacoes pa on pa.id = pr.participacao_id and pa.empresa_id = pr.empresa_id
         where pa.acompanhamento_id = ${id}::uuid and pr.empresa_id = ${empresa}::uuid and pa.deleted_at is null`.execute(tx)).rows : [];

      let contratoId: string | null = null;
      let contratos: ItemLinhaTempo[] = [];
      if (ac.veContratos) {
        const cts = (await sql<{ id: string }>`
          select c.id from priv.contratos c
           where c.acompanhamento_id = ${id}::uuid and c.empresa_id = ${empresa}::uuid and c.deleted_at is null
           order by c.created_at desc limit 1`.execute(tx)).rows;
        contratoId = cts[0]?.id ?? null;

        contratos = (await sql<ItemLinhaTempo>`
          select 'contrato'::text as origem, c.id,
                 case when c.tipo = 'ata' then 'ata_registro_precos' else 'contrato' end as tipo,
                 c.status as subtipo,
                 ((case when c.tipo = 'ata' then 'Ata de registro de preços ' else 'Contrato ' end) || c.numero) as titulo,
                 c.vigencia_inicio::text as "dataAto", c.numero, null::uuid as "participacaoId",
                 null::text as "concorrenteCnpj", null::text as observacao, null::text as link,
                 null::jsonb as documento,
                 ('/contratos/' || c.id) as "refRota"
            from priv.contratos c
           where c.acompanhamento_id = ${id}::uuid and c.empresa_id = ${empresa}::uuid and c.deleted_at is null
          union all
          select 'empenho'::text as origem, e.id, 'empenho'::text as tipo, e.etapa as subtipo,
                 ((case when e.tipo = 'ordem_fornecimento' then 'Ordem de fornecimento ' else 'Nota de empenho ' end) || e.numero) as titulo,
                 e.emitido_em::text as "dataAto", e.numero, null::uuid as "participacaoId",
                 null::text as "concorrenteCnpj", e.observacao, null::text as link,
                 null::jsonb as documento,
                 ('/contratos/' || c.id) as "refRota"
            from priv.empenhos e
            join priv.contratos c on c.id = e.contrato_id and c.empresa_id = e.empresa_id
           where c.acompanhamento_id = ${id}::uuid and e.empresa_id = ${empresa}::uuid and c.deleted_at is null
          union all
          select 'anexo_contrato'::text as origem, ca.id, 'anexo_contrato'::text as tipo, ca.etapa as subtipo,
                 coalesce(d.descricao, ca.nota, 'Anexo do contrato ' || c.numero) as titulo,
                 (ca.created_at at time zone 'America/Sao_Paulo')::date::text as "dataAto",
                 c.numero, null::uuid as "participacaoId",
                 null::text as "concorrenteCnpj", ca.nota as observacao, null::text as link,
                 case when d.id is not null then jsonb_build_object(
                   'id', d.id, 'versaoId', s.versao_id, 'nome', d.descricao, 'status', s.status
                 ) else null end as documento,
                 ('/contratos/' || c.id) as "refRota"
            from priv.contrato_anexos ca
            join priv.contratos c on c.id = ca.contrato_id and c.empresa_id = ca.empresa_id
            left join priv.documentos d on d.id = ca.documento_id
            left join priv.documentos_status s on s.documento_id = d.id
           where c.acompanhamento_id = ${id}::uuid and ca.empresa_id = ${empresa}::uuid and c.deleted_at is null`.execute(tx)).rows;
      }

      const resultados = (await sql<{ participacaoId: string; resultado: string }>`
        select r.participacao_id as "participacaoId", r.resultado_final as resultado
          from priv.resultados_item r
          join priv.participacoes pa on pa.id = r.participacao_id and pa.empresa_id = r.empresa_id
         where pa.acompanhamento_id = ${id}::uuid and r.empresa_id = ${empresa}::uuid and pa.deleted_at is null`.execute(tx)).rows;

      const pendencias: Array<{ codigo: string; participacaoId: string }> = [];
      for (const res of resultados) {
        if (res.resultado === 'homologada') {
          const temHomologacao = registros.some(
            (x) => x.tipo === 'homologacao' && (x.participacaoId === null || x.participacaoId === res.participacaoId),
          );
          if (!temHomologacao) pendencias.push({ codigo: 'homologada_sem_documento', participacaoId: res.participacaoId });
        } else if (res.resultado === 'adjudicada') {
          const temAdjudicacao = registros.some(
            (x) => x.tipo === 'adjudicacao' && (x.participacaoId === null || x.participacaoId === res.participacaoId),
          );
          if (!temAdjudicacao) pendencias.push({ codigo: 'adjudicada_sem_documento', participacaoId: res.participacaoId });
        } else if (res.resultado === 'contratada' && ac.veContratos && !contratoId) {
          pendencias.push({ codigo: 'contratada_sem_contrato', participacaoId: res.participacaoId });
        }
      }

      const todos = [...registros, ...propostas, ...juridico, ...contratos]
        .filter((item) => (!f.tipo || item.tipo === f.tipo || item.origem === f.tipo))
        .filter((item) => (!f.participacao || item.participacaoId === null || item.participacaoId === f.participacao))
        .sort((a, b) => b.dataAto.localeCompare(a.dataAto));

      return {
        linhaDoTempo: todos,
        grupos: {
          propostas: ac.vePropostas ? true : null,
          juridico: ac.veJuridico ? true : null,
          contratos: ac.veContratos ? true : null,
        },
        pendencias,
        contratoId,
      };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/acompanhamentos/:id/documentos-posteriores')
  @HttpCode(201)
  async registrarDocumentoPosterior(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(docPosteriorSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.registrar_documento_posterior(
        ${empresa}::uuid, ${id}::uuid, ${d.participacaoId ?? null}::uuid, ${d.tipo}, ${d.subtipo ?? null},
        ${d.dataAto}::date, ${d.numero ?? null}, ${d.documentoId ?? null}::uuid, ${d.link ?? null},
        ${d.concorrenteCnpj ?? null}, ${d.recursoTerceiroId ?? null}::uuid, ${d.observacao ?? null}
      ) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/acompanhamentos/:id/habilitacao-apresentada')
  @HttpCode(201)
  async registrarHabilitacaoApresentada(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(habilitacaoApresentadaSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ gravados: number }>`
      select priv.registrar_habilitacao_apresentada(${empresa}::uuid, ${id}::uuid, ${d.dataAto}::date) as gravados`.execute(tx));
    return { gravados: r.rows[0]?.gravados ?? 0 };
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/documentos-posteriores/:id/remover')
  @HttpCode(204)
  async removerDocumentoPosterior(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(removerDocPosteriorSchema, corpo);
    await this.q(req, (tx) => sql`
      select priv.remover_documento_posterior(${empresa}::uuid, ${id}::uuid, ${d.motivo})`.execute(tx));
  }
}
