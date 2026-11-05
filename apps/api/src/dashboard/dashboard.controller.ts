import { Body, Controller, Get, HttpCode, Param, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type Transaction, sql } from 'kysely';
import { celula } from '../agenda/csv.js';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const assinaturaSchema = z.object({ ativo: z.boolean() }).strict();

// Dashboard e relatórios (spec fase-12). Cada indicador vem de contagem/soma direta dos registros da empresa e só é calculado quando a pessoa
// tem a permissão do módulo de origem (senão vem `null`, nunca zero enganoso). Dinheiro como texto decimal (regra 14); nada é estimado.
@Controller()
export class DashboardController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // Relatório diário por e-mail (12.2): opt-in da PRÓPRIA pessoa nesta empresa. O envio é do worker; a API só liga e desliga.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/relatorio-diario')
  async assinatura(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    const r = await this.q(req, (tx) => sql<{ ativo: boolean }>`select priv.minha_assinatura_relatorio(${empresa}::uuid) as ativo`.execute(tx));
    return { ativo: r.rows[0]?.ativo ?? false };
  }

  @Permissao('agenda', 'visualizar')
  @Put('empresas/:empresa/relatorio-diario')
  @HttpCode(204)
  async definirAssinatura(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(assinaturaSchema, corpo);
    await this.q(req, (tx) => sql`select priv.definir_relatorio_diario(${empresa}::uuid, ${d.ativo})`.execute(tx));
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/dashboard')
  async dashboard(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    const e = empresa;
    return this.q(req, async (tx): Promise<Record<string, unknown>> => (await sql<Record<string, unknown>>`
      with p as (select
        core.has_permission(${e}::uuid, 'editais', 'visualizar') as editais, core.has_permission(${e}::uuid, 'propostas', 'visualizar') as propostas,
        core.has_permission(${e}::uuid, 'analises', 'visualizar') as analises, core.has_permission(${e}::uuid, 'juridico', 'visualizar') as juridico,
        core.has_permission(${e}::uuid, 'documentos', 'visualizar') as documentos, core.has_permission(${e}::uuid, 'contratos', 'visualizar') as contratos,
        core.has_permission(${e}::uuid, 'financeiro', 'visualizar') as financeiro, (now() at time zone 'America/Sao_Paulo')::date as hoje)
      select
        (select hoje::text from p) as hoje,
        case when p.editais then (select count(*)::int from priv.oportunidades o where o.empresa_id = ${e}::uuid and o.triagem = 'nova') end as "oportunidadesNovas",
        (select count(*)::int from priv.acompanhamentos a where a.empresa_id = ${e}::uuid and a.deleted_at is null and a.status not in ('encerrado', 'desistiu') and a.data_abertura > now()) as "disputasFuturas",
        case when p.propostas then (select count(*)::int from priv.propostas x where x.empresa_id = ${e}::uuid and x.deleted_at is null and x.status in ('rascunho', 'conferencia', 'aprovada')) end as "propostasPendentes",
        case when p.analises then (select count(*)::int from priv.analises_item x where x.empresa_id = ${e}::uuid and (x.resumo is null or x.resumo = 'PENDENTE')) end as "analisesPendentes",
        (select count(*)::int from priv.agenda_eventos ev where ev.empresa_id = ${e}::uuid and ev.tipo in ('esclarecimento', 'impugnacao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes') and ev.status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado')) as "prazosJuridicosAbertos",
        (select count(*)::int from priv.agenda_eventos ev where ev.empresa_id = ${e}::uuid and ev.tipo in ('esclarecimento', 'impugnacao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes') and ev.status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado') and ev.data_limite_legal < now()) as "prazosJuridicosVencidos",
        case when p.documentos then (select count(*)::int from priv.documentos d join lateral (select v.validade from priv.documento_versoes v where v.documento_id = d.id and v.status_arquivo <> 'bloqueado' order by v.versao desc limit 1) v on true
           where d.empresa_id = ${e}::uuid and d.deleted_at is null and not d.sem_vencimento and v.validade is not null and v.validade >= p.hoje and v.validade <= p.hoje + 30) end as "documentosVencendo",
        case when p.documentos then (select count(*)::int from priv.documentos d join lateral (select v.validade from priv.documento_versoes v where v.documento_id = d.id and v.status_arquivo <> 'bloqueado' order by v.versao desc limit 1) v on true
           where d.empresa_id = ${e}::uuid and d.deleted_at is null and not d.sem_vencimento and v.validade is not null and v.validade < p.hoje) end as "documentosVencidos",
        (select count(*)::int from priv.resultados_item r where r.empresa_id = ${e}::uuid and r.resultado_final in ('adjudicada', 'homologada', 'contratada')) as "licitacoesGanhas",
        (select round(coalesce(sum(r.valor_final), 0), 4)::text from priv.resultados_item r where r.empresa_id = ${e}::uuid and r.resultado_final in ('adjudicada', 'homologada', 'contratada')) as "valorGanho",
        case when p.contratos then (select count(*)::int from priv.contratos c where c.empresa_id = ${e}::uuid and c.deleted_at is null and c.status = 'ativo') end as "contratosAtivos",
        case when p.contratos then (select count(*)::int from priv.empenhos x join priv.contratos c on c.id = x.contrato_id where x.empresa_id = ${e}::uuid and c.status = 'ativo' and x.etapa not in ('recebimento_definitivo', 'concluido')) end as "entregasPendentes",
        case when p.financeiro then (select round(coalesce(sum(f.valor - f.retencoes - coalesce(f.valor_recebido, 0)), 0), 4)::text from priv.faturas f where f.empresa_id = ${e}::uuid and f.pago_em is null) end as "valoresAReceber"
      from p`.execute(tx)).rows[0] ?? {});
  }

  // Relatório comercial (12.3): participações, vitórias, derrotas e motivos, taxa de sucesso, valor disputado e ganho, produtos mais ofertados e órgãos.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/relatorios/comercial')
  async comercial(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    const e = empresa;
    return this.q(req, async (tx) => {
      const resumo = (await sql<Record<string, unknown>>`
        select (select count(*)::int from priv.participacoes where empresa_id = ${e}::uuid and deleted_at is null and status not in ('avaliando', 'nao_vai', 'cancelada')) as participacoes,
               count(*) filter (where r.resultado_final in ('adjudicada', 'homologada', 'contratada'))::int as vitorias,
               count(*) filter (where r.resultado_final in ('perdida', 'inabilitada', 'desclassificada'))::int as derrotas,
               coalesce(sum(r.valor_final), 0)::text as "valorDisputado",
               coalesce(sum(r.valor_final) filter (where r.resultado_final in ('adjudicada', 'homologada', 'contratada')), 0)::text as "valorGanho",
               case when count(*) filter (where r.resultado_final in ('adjudicada', 'homologada', 'contratada', 'perdida', 'inabilitada', 'desclassificada')) = 0 then null
                    else round(100.0 * count(*) filter (where r.resultado_final in ('adjudicada', 'homologada', 'contratada')) / count(*) filter (where r.resultado_final in ('adjudicada', 'homologada', 'contratada', 'perdida', 'inabilitada', 'desclassificada')), 2)::text end as "taxaSucessoPct"
          from priv.resultados_item r where r.empresa_id = ${e}::uuid`.execute(tx)).rows[0] ?? {};
      const motivos = (await sql`select left(coalesce(motivo_perda, 'Sem motivo informado'), 120) as motivo, count(*)::int as total from priv.resultados_item where empresa_id = ${e}::uuid and resultado_final in ('perdida', 'inabilitada', 'desclassificada') group by 1 order by 2 desc, 1 limit 10`.execute(tx)).rows;
      const produtos = (await sql`select coalesce(nullif(btrim(concat_ws(' ', marca, modelo)), ''), 'Sem marca informada') as produto, count(*)::int as total from priv.participacoes where empresa_id = ${e}::uuid and deleted_at is null and status not in ('avaliando', 'nao_vai', 'cancelada') group by 1 order by 2 desc, 1 limit 10`.execute(tx)).rows;
      const orgaos = (await sql`select g.razao_social as orgao, count(*)::int as total from priv.participacoes pa join priv.acompanhamentos a on a.id = pa.acompanhamento_id join pub.editais ed on ed.id = a.edital_id join pub.orgaos g on g.id = ed.orgao_id
        where pa.empresa_id = ${e}::uuid and pa.deleted_at is null and pa.status in ('arrematada', 'adjudicada', 'homologada', 'contratada') group by 1 order by 2 desc, 1 limit 10`.execute(tx)).rows;
      return { ...resumo, motivos, produtos, orgaos };
    });
  }

  // Exportação CSV dos resultados (12.5): UTF-8 com BOM, separador ";", texto protegido contra fórmula do Excel.
  @Permissao('agenda', 'exportar')
  @Get('empresas/:empresa/relatorios/resultados.csv')
  async csvResultados(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Param('empresa') empresa: string) {
    const linhas = await this.q(req, async (tx) => (await sql<Record<string, string | null>>`
      select to_char(r.ocorrido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as quando, g.razao_social as orgao, e.numero_edital as edital, e.processo, i.numero_item::text as item, r.resultado_final as resultado,
             r.valor_inicial::text as "valorInicial", r.valor_final::text as "valorFinal", r.melhor_lance::text as "melhorLance", r.classificacao::text as classificacao, r.vencedora_nome as vencedora, r.vencedora_marca_modelo as "marcaVencedora",
             concat_ws(' ', pa.marca, pa.modelo) as "nossoProduto", r.motivo_perda as motivo
        from priv.resultados_item r join priv.participacoes pa on pa.id = r.participacao_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id left join pub.editais e on e.id = a.edital_id
        left join pub.orgaos g on g.id = e.orgao_id left join pub.edital_itens i on i.id = pa.item_id where r.empresa_id = ${empresa}::uuid order by r.ocorrido_em desc limit 5000`.execute(tx)).rows);
    const cab = ['Data', 'Órgão', 'Edital', 'Processo', 'Item', 'Resultado', 'Valor inicial', 'Valor final', 'Melhor lance', 'Classificação', 'Vencedora', 'Marca/modelo da vencedora', 'Nosso produto', 'Motivo'];
    const chaves = ['quando', 'orgao', 'edital', 'processo', 'item', 'resultado', 'valorInicial', 'valorFinal', 'melhorLance', 'classificacao', 'vencedora', 'marcaVencedora', 'nossoProduto', 'motivo'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="resultados-vv-licitacoes.csv"');
    return `﻿${[cab, ...linhas.map((l) => chaves.map((k) => l[k] ?? ''))].map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
  }
}
