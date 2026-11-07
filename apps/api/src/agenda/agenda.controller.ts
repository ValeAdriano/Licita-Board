import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { CABECALHO, type EventoCsv, gerarCsv, montarLinhas } from './csv.js';
import { type EventoIcs, gerarIcs } from './ics.js';
import { TIPO_XLSX, gerarXlsx } from '../exportacao/xlsx.js';

const instante = z.iso.datetime({ offset: true });
const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'] as const;
const SITUACAO = ['a_confirmar', 'pendente', 'em_andamento', 'ok', 'nao_se_aplica'] as const;
const https = z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use um link https.');

const filtroEventos = z.object({
  de: instante.optional(), ate: instante.optional(), status: z.string().max(200).optional(), tipo: z.string().max(200).optional(),
  responsavel: z.uuid().optional(), acompanhamento: z.uuid().optional(),
}).strict();
const feriadoSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nome: z.string().trim().min(2).max(120), tipo: z.enum(['feriado', 'ponto_facultativo']).default('feriado'),
  abrangencia: z.enum(['uf', 'municipio']), uf: z.string().regex(/^[A-Z]{2}$/), codigoIbge: z.string().regex(/^\d{7}$/).nullable().optional(),
}).strict();
const parametrosSchema = z.object({ diasInternos: z.number().int().min(0).max(10) }).strict();
const aberturaSchema = z.object({
  data: instante, origem: z.enum(['edital', 'portal', 'manual']), clausula: z.string().trim().max(300).nullable().optional(),
  prazoEsclarecimento: instante.nullable().optional(), prazoImpugnacao: instante.nullable().optional(), clausulaPrazos: z.string().trim().max(300).nullable().optional(),
}).strict();
const acompSchema = z.object({
  responsavelId: z.uuid().nullable().optional(), prioridade: z.enum(PRIORIDADES).optional(),
  status: z.enum(['acompanhando', 'em_elaboracao', 'aguardando_sessao', 'em_disputa', 'encerrado', 'desistiu']).optional(),
  portal: z.string().trim().max(120).nullable().optional(), linkDisputa: https.nullable().optional(), linkDocumentos: https.nullable().optional(),
  observacoes: z.string().trim().max(4000).nullable().optional(), conferido: z.boolean().optional(),
}).strict();
const partSchema = z.object({
  responsavelId: z.uuid().nullable().optional(), prioridade: z.enum(PRIORIDADES).optional(),
  status: z.enum(['avaliando', 'aguardando_analise', 'vai_participar', 'nao_vai', 'proposta_preparada', 'proposta_cadastrada', 'proposta_enviada', 'em_disputa', 'arrematada', 'habilitacao', 'em_fase_recursal', 'adjudicada', 'homologada', 'contratada', 'vencida', 'perdida', 'inabilitada', 'desclassificada', 'fracassada', 'deserta', 'revogada', 'anulada', 'cancelada']).optional(),
  situacaoDocumentacao: z.enum(SITUACAO).optional(), situacaoProposta: z.enum(SITUACAO).optional(), situacaoJuridica: z.enum(SITUACAO).optional(),
  atendimentoTecnico: z.string().trim().max(2000).nullable().optional(), marca: z.string().trim().max(120).nullable().optional(),
  modelo: z.string().trim().max(120).nullable().optional(), versao: z.string().trim().max(120).nullable().optional(),
  // Dinheiro como string decimal (nunca number).
  valorUnitario: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).nullable().optional(), valorTotal: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).nullable().optional(),
  pendencias: z.string().trim().max(2000).nullable().optional(), observacoes: z.string().trim().max(4000).nullable().optional(),
}).strict();

// Agenda e acompanhamento de editais (spec fase-05). A API NUNCA calcula prazo: grava o fato (abertura confirmada,
// fato gerador) por função do banco, que enfileira o recálculo; quem calcula é o worker (rules/prazos.py).
@Controller()
export class AgendaController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/agenda/responsaveis')
  responsaveis(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`select usuario_id as id, nome from priv.responsaveis_agenda(${empresa}::uuid)`.execute(tx)).rows);
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/agenda/eventos')
  eventos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    return this.listarEventos(req, empresa, validar(filtroEventos, consulta));
  }

  // Exportação .ics (mesmos filtros da lista). Instantâneo: o calendário externo não acompanha recálculos.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/agenda/calendario.ics')
  async calendario(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const eventos = await this.listarEventos(req, empresa, validar(filtroEventos, consulta));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="agenda-vv-licitacoes.ics"');
    return gerarIcs(eventos as unknown as EventoIcs[], new Date());
  }

  // Configuração da agenda da empresa: parâmetro D-N, feriados próprios e os municípios dos editais que ela acompanha.
  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/agenda/configuracao')
  configuracao(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => {
      const p = (await sql<{ d: number }>`select dias_internos as d from priv.agenda_parametros where empresa_id = ${empresa}::uuid`.execute(tx)).rows[0];
      const feriados = (await sql`
        select id, data::text as data, nome, tipo, abrangencia, uf, codigo_ibge as "codigoIbge"
          from priv.agenda_feriados where empresa_id = ${empresa}::uuid and deleted_at is null order by data limit 500`.execute(tx)).rows;
      const orgaos = (await sql`
        select distinct g.uf, g.municipio, g.codigo_ibge as "codigoIbge"
          from priv.acompanhamentos a join pub.editais e on e.id = a.edital_id join pub.orgaos g on g.id = e.orgao_id
         where a.empresa_id = ${empresa}::uuid and a.deleted_at is null and g.uf is not null order by g.uf, g.municipio limit 200`.execute(tx)).rows;
      return { diasInternos: p?.d ?? 2, padraoDiasInternos: 2, feriados, orgaos };
    });
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/agenda/feriados')
  @HttpCode(201)
  async cadastrarFeriado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(feriadoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.cadastrar_feriado_agenda(${empresa}::uuid, ${d.data}::date, ${d.nome}, ${d.tipo}, ${d.abrangencia}, ${d.uf}, ${d.codigoIbge ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'recalculando' };
  }

  @Permissao('agenda', 'editar')
  @Delete('empresas/:empresa/agenda/feriados/:id')
  @HttpCode(204)
  async removerFeriado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.remover_feriado_agenda(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('agenda', 'aprovar')
  @Post('empresas/:empresa/agenda/parametros')
  @HttpCode(204)
  async definirParametros(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(parametrosSchema, corpo);
    await this.q(req, (tx) => sql`select priv.definir_dias_internos(${empresa}::uuid, ${d.diasInternos}::int)`.execute(tx));
  }

  // Exportação em CSV (Excel pt-BR) com os mesmos filtros da lista.
  @Permissao('agenda', 'exportar')
  @Get('empresas/:empresa/agenda/eventos.csv')
  async planilha(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const eventos = await this.listarEventos(req, empresa, validar(filtroEventos, consulta));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="agenda-vv-licitacoes.csv"');
    return gerarCsv(eventos as unknown as EventoCsv[]);
  }

  // Exportação Excel com as mesmas linhas, filtros e permissão do CSV. Texto é gravado em linha pelo gerador (não vira fórmula).
  @Permissao('agenda', 'exportar')
  @Get('empresas/:empresa/agenda/eventos.xlsx')
  async eventosXlsx(@Req() req: RequisicaoVV, @Res({ passthrough: true }) res: Response, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const eventos = await this.listarEventos(req, empresa, validar(filtroEventos, consulta));
    const buf = gerarXlsx([{ nome: 'Agenda', colunas: CABECALHO.map((titulo, i) => ({ titulo, largura: [4, 8, 9, 14].includes(i) ? 24 : i === 8 || i === 14 ? 48 : 18 })), linhas: montarLinhas(eventos as unknown as EventoCsv[]) }]);
    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename="agenda-vv-licitacoes.xlsx"');
    return new StreamableFile(buf);
  }

  private listarEventos(req: RequisicaoVV, empresa: string, f: z.infer<typeof filtroEventos>) {
    const status = f.status ? f.status.split(',') : null;
    const tipo = f.tipo ? f.tipo.split(',') : null;
    return this.q(req, async (tx) => (await sql`
      select ev.id, ev.tipo, ev.status, ev.data_limite_legal as "dataLimite", ev.data_interna_recomendada as "dataInterna", ev.provisorio,
             ev.regra_validada as "regraValidada", ev.origem_prazo as "origemPrazo", ev.clausula_edital as "clausula", ev.aviso_calculo as "aviso",
             ev.responsavel_id as "responsavelId", u.nome as "responsavel", a.id as "acompanhamentoId", a.prioridade, a.status as "statusAcompanhamento",
             e.id as "editalId", e.numero_edital as "numeroEdital", left(e.objeto, 200) as objeto, g.razao_social as orgao, g.uf, g.municipio
        from priv.agenda_eventos ev
        join priv.acompanhamentos a on a.id = ev.acompanhamento_id and a.deleted_at is null
        join pub.editais e on e.id = a.edital_id
        join pub.orgaos g on g.id = e.orgao_id
        left join core.usuarios u on u.id = coalesce(ev.responsavel_id, a.responsavel_id)
       where ev.empresa_id = ${empresa}::uuid
         and (${f.de ?? null}::timestamptz is null or ev.data_limite_legal >= ${f.de ?? null}::timestamptz)
         and (${f.ate ?? null}::timestamptz is null or ev.data_limite_legal < ${f.ate ?? null}::timestamptz)
         and (${status}::text[] is null or ev.status = any (${status}::text[]))
         and (${tipo}::text[] is null or ev.tipo = any (${tipo}::text[]))
         and (${f.responsavel ?? null}::uuid is null or coalesce(ev.responsavel_id, a.responsavel_id) = ${f.responsavel ?? null}::uuid)
         and (${f.acompanhamento ?? null}::uuid is null or a.id = ${f.acompanhamento ?? null}::uuid)
       order by ev.data_limite_legal nulls last limit 1000`.execute(tx)).rows);
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/agenda/acompanhamentos')
  acompanhamentos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select a.id, a.status, a.prioridade, a.data_abertura as "dataAbertura", a.abertura_confirmada as "aberturaConfirmada", a.confiabilidade,
             a.responsavel_id as "responsavelId", u.nome as responsavel, e.id as "editalId", e.numero_edital as "numeroEdital", left(e.objeto, 200) as objeto,
             e.versao_atual > a.edital_versao_vista as "editalAlterado", a.abertura_reconfirmar as "aberturaReconfirmar", g.razao_social as orgao, g.uf, g.municipio,
             (select count(*)::int from priv.participacoes p where p.acompanhamento_id = a.id and p.deleted_at is null) as "itens",
             (select min(x.data_limite_legal) from priv.agenda_eventos x where x.acompanhamento_id = a.id and x.tipo <> 'disputa'
                 and x.status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado') and x.data_limite_legal >= now()) as "proximoPrazo",
             (select count(*)::int from priv.agenda_eventos x where x.acompanhamento_id = a.id and x.status = 'prazo_perdido') as "prazosPerdidos"
        from priv.acompanhamentos a
        join pub.editais e on e.id = a.edital_id
        join pub.orgaos g on g.id = e.orgao_id
        left join core.usuarios u on u.id = a.responsavel_id
       where a.empresa_id = ${empresa}::uuid and a.deleted_at is null
       order by a.data_abertura nulls last limit 500`.execute(tx)).rows);
  }

  @Permissao('agenda', 'visualizar')
  @Get('empresas/:empresa/acompanhamentos/:id')
  async acompanhamento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const a = (await sql`
        select a.id, a.status, a.prioridade, a.data_abertura as "dataAbertura", a.abertura_origem as "aberturaOrigem", a.abertura_confirmada as "aberturaConfirmada",
               a.abertura_clausula as "aberturaClausula", a.portal, a.link_disputa as "linkDisputa", a.link_documentos as "linkDocumentos",
               a.prazo_esclarecimento_edital as "prazoEsclarecimentoEdital", a.prazo_impugnacao_edital as "prazoImpugnacaoEdital", a.clausula_prazos as "clausulaPrazos",
               a.confiabilidade, a.observacoes, a.ultima_conferencia_em as "ultimaConferenciaEm", a.responsavel_id as "responsavelId",
               a.edital_versao_vista as "editalVersaoVista", a.abertura_reconfirmar as "aberturaReconfirmar", e.id as "editalId", e.numero_edital as "numeroEdital", e.processo, e.modalidade, e.objeto,
               e.versao_atual as "editalVersaoAtual", e.link_origem as "linkOrigem", e.data_encerramento_propostas as "encerramentoPropostasPncp", e.situacao as "situacaoEdital",
               g.razao_social as orgao, g.uf, g.municipio, g.codigo_ibge as "codigoIbge"
          from priv.acompanhamentos a join pub.editais e on e.id = a.edital_id join pub.orgaos g on g.id = e.orgao_id
         where a.id = ${id}::uuid and a.empresa_id = ${empresa}::uuid and a.deleted_at is null`.execute(tx)).rows[0];
      if (!a) return null;
      const itens = (await sql`
        select i.id as "itemId", i.numero_item as "numeroItem", i.descricao, i.quantidade::text as quantidade, i.unidade_medida as "unidadeMedida",
               i.valor_unitario_estimado::text as "valorEstimado", i.beneficio, i.versao_final is not null as retirado,
               p.id as "participacaoId", p.status, p.prioridade, p.responsavel_id as "responsavelId", p.situacao_documentacao as "situacaoDocumentacao",
               p.situacao_proposta as "situacaoProposta", p.situacao_juridica as "situacaoJuridica", p.atendimento_tecnico as "atendimentoTecnico",
               p.marca, p.modelo, p.versao, p.valor_unitario::text as "valorUnitario", p.valor_total::text as "valorTotal", p.pendencias, p.observacoes
          from pub.edital_itens i
          left join priv.participacoes p on p.item_id = i.id and p.empresa_id = ${empresa}::uuid and p.deleted_at is null
         where i.edital_id = (select edital_id from priv.acompanhamentos where id = ${id}::uuid) and i.tipo = 'item'
         order by i.numero_item limit 2000`.execute(tx)).rows;
      const eventos = (await sql`
        select ev.id, ev.tipo, ev.status, ev.base_data as "baseData", ev.data_limite_legal as "dataLimite", ev.data_interna_recomendada as "dataInterna",
               ev.origem_prazo as "origemPrazo", ev.clausula_edital as clausula, ev.provisorio, ev.regra_validada as "regraValidada", ev.aviso_calculo as aviso,
               ev.justificativa, ev.responsavel_id as "responsavelId", r.artigo
          from priv.agenda_eventos ev left join pub.regras_prazo r on r.id = ev.regra_id
         where ev.acompanhamento_id = ${id}::uuid order by ev.data_limite_legal nulls last`.execute(tx)).rows;
      const historico = (await sql`
        select h.id, h.evento_id as "eventoId", h.campo, h.antes, h.depois, h.motivo, h.em, u.nome as quem
          from priv.agenda_evento_historico h left join core.usuarios u on u.id = h.quem
         where h.evento_id in (select id from priv.agenda_eventos where acompanhamento_id = ${id}::uuid) order by h.em desc limit 100`.execute(tx)).rows;
      return { ...a, itens, eventos, historico };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('agenda', 'cadastrar')
  @Post('empresas/:empresa/acompanhamentos')
  async acompanhar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(z.object({ editalId: z.uuid() }).strict(), corpo);
    const r = await this.q(req, async (tx) => (await sql<{ id: string }>`select priv.acompanhar_edital(${empresa}::uuid, ${d.editalId}::uuid) as id`.execute(tx)).rows[0]);
    return { id: r?.id };
  }

  // "Tenho interesse": acompanhamento do edital + participação do item em um clique.
  @Permissao('agenda', 'cadastrar')
  @Post('empresas/:empresa/oportunidades/:id/acompanhar')
  async promover(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => (await sql<{ id: string }>`select priv.promover_oportunidade(${empresa}::uuid, ${id}::uuid) as id`.execute(tx)).rows[0]);
    return { id: r?.id };
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/acompanhamentos/:id/abertura')
  @HttpCode(202)
  async abertura(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(aberturaSchema, corpo);
    await this.q(req, (tx) => sql`select priv.confirmar_abertura(${empresa}::uuid, ${id}::uuid, ${d.data}::timestamptz, ${d.origem}, ${d.clausula ?? null},
      ${d.prazoEsclarecimento ?? null}::timestamptz, ${d.prazoImpugnacao ?? null}::timestamptz, ${d.clausulaPrazos ?? null})`.execute(tx));
    return { status: 'recalculando' };
  }

  @Permissao('agenda', 'editar')
  @Patch('empresas/:empresa/acompanhamentos/:id')
  @HttpCode(204)
  async atualizar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(acompSchema, corpo);
    const r = await this.q(req, (tx) => sql`
      update priv.acompanhamentos set
        responsavel_id = case when ${'responsavelId' in d}::boolean then ${d.responsavelId ?? null}::uuid else responsavel_id end,
        prioridade = coalesce(${d.prioridade ?? null}, prioridade), status = coalesce(${d.status ?? null}, status),
        portal = case when ${'portal' in d}::boolean then ${d.portal ?? null} else portal end,
        link_disputa = case when ${'linkDisputa' in d}::boolean then ${d.linkDisputa ?? null} else link_disputa end,
        link_documentos = case when ${'linkDocumentos' in d}::boolean then ${d.linkDocumentos ?? null} else link_documentos end,
        observacoes = case when ${'observacoes' in d}::boolean then ${d.observacoes ?? null} else observacoes end,
        ultima_conferencia_em = case when ${d.conferido ?? false}::boolean then now() else ultima_conferencia_em end,
        edital_versao_vista = case when ${d.conferido ?? false}::boolean then (select versao_atual from pub.editais where id = edital_id) else edital_versao_vista end
       where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  @Permissao('agenda', 'cadastrar')
  @Post('empresas/:empresa/acompanhamentos/:id/participacoes')
  @HttpCode(201)
  async criarParticipacoes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(z.object({ itemIds: z.array(z.uuid()).min(1).max(2000) }).strict(), corpo);
    const r = await this.q(req, async (tx) => (await sql<{ n: number }>`select priv.criar_participacoes(${empresa}::uuid, ${id}::uuid, ${d.itemIds}::uuid[]) as n`.execute(tx)).rows[0]);
    return { criadas: r?.n ?? 0 };
  }

  @Permissao('agenda', 'editar')
  @Patch('empresas/:empresa/participacoes/:pid')
  @HttpCode(204)
  async atualizarParticipacao(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('pid', new ParseUUIDPipe()) pid: string, @Body() corpo: unknown) {
    const d = validar(partSchema, corpo);
    const tem = (k: string) => k in d;
    const r = await this.q(req, (tx) => sql`
      update priv.participacoes set
        responsavel_id = case when ${tem('responsavelId')}::boolean then ${d.responsavelId ?? null}::uuid else responsavel_id end,
        prioridade = coalesce(${d.prioridade ?? null}, prioridade), status = coalesce(${d.status ?? null}, status),
        situacao_documentacao = coalesce(${d.situacaoDocumentacao ?? null}, situacao_documentacao),
        situacao_proposta = coalesce(${d.situacaoProposta ?? null}, situacao_proposta),
        situacao_juridica = coalesce(${d.situacaoJuridica ?? null}, situacao_juridica),
        atendimento_tecnico = case when ${tem('atendimentoTecnico')}::boolean then ${d.atendimentoTecnico ?? null} else atendimento_tecnico end,
        marca = case when ${tem('marca')}::boolean then ${d.marca ?? null} else marca end,
        modelo = case when ${tem('modelo')}::boolean then ${d.modelo ?? null} else modelo end,
        versao = case when ${tem('versao')}::boolean then ${d.versao ?? null} else versao end,
        valor_unitario = case when ${tem('valorUnitario')}::boolean then ${d.valorUnitario ?? null}::numeric else valor_unitario end,
        valor_total = case when ${tem('valorTotal')}::boolean then ${d.valorTotal ?? null}::numeric else valor_total end,
        pendencias = case when ${tem('pendencias')}::boolean then ${d.pendencias ?? null} else pendencias end,
        observacoes = case when ${tem('observacoes')}::boolean then ${d.observacoes ?? null} else observacoes end
       where id = ${pid}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/acompanhamentos/:id/fatos')
  @HttpCode(202)
  async fato(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(z.object({
      tipo: z.enum(['resposta_administracao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes', 'regularizacao_fiscal_me_epp']), dataBase: instante,
    }).strict(), corpo);
    await this.q(req, (tx) => sql`select priv.registrar_fato(${empresa}::uuid, ${id}::uuid, ${d.tipo}, ${d.dataBase}::timestamptz)`.execute(tx));
    return { status: 'recalculando' };
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/eventos/:ev/status')
  @HttpCode(204)
  async statusEvento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('ev', new ParseUUIDPipe()) ev: string, @Body() corpo: unknown) {
    const d = validar(z.object({
      status: z.enum(['sugerido', 'em_elaboracao', 'em_revisao', 'aprovado', 'protocolado', 'respondido', 'dispensado']), justificativa: z.string().trim().max(1000).nullable().optional(),
    }).strict(), corpo);
    await this.q(req, (tx) => sql`select priv.mudar_status_evento(${empresa}::uuid, ${ev}::uuid, ${d.status}, ${d.justificativa ?? null})`.execute(tx));
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/eventos/:ev/prazo')
  @HttpCode(204)
  async prazoEvento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('ev', new ParseUUIDPipe()) ev: string, @Body() corpo: unknown) {
    const d = validar(z.object({ dataLimite: instante, justificativa: z.string().trim().min(10).max(1000) }).strict(), corpo);
    await this.q(req, (tx) => sql`select priv.override_prazo(${empresa}::uuid, ${ev}::uuid, ${d.dataLimite}::timestamptz, ${d.justificativa})`.execute(tx));
  }

  @Permissao('agenda', 'editar')
  @Post('empresas/:empresa/eventos/:ev/responsavel')
  @HttpCode(204)
  async responsavelEvento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('ev', new ParseUUIDPipe()) ev: string, @Body() corpo: unknown) {
    const d = validar(z.object({ responsavelId: z.uuid().nullable() }).strict(), corpo);
    const r = await this.q(req, (tx) => sql`update priv.agenda_eventos set responsavel_id = ${d.responsavelId}::uuid where id = ${ev}::uuid and empresa_id = ${empresa}::uuid`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }
}
