import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { S3Servico } from '../documentos/s3.service.js';

const instante = z.iso.datetime({ offset: true });
const baseSchema = z.object({
  tipo: z.enum(['lei', 'lei_complementar', 'decreto', 'regulamento', 'acordao', 'sumula', 'constituicao']), numero: z.string().trim().max(40).nullable().optional(), orgao: z.string().trim().max(40).nullable().optional(),
  dispositivo: z.string().trim().max(60).nullable().optional(), titulo: z.string().trim().min(3).max(300), ementa: z.string().trim().max(4000).nullable().optional(),
  dataAto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), linkOficial: z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use o link oficial em https.'),
}).strict();
const criarSchema = z.object({ tipo: z.enum(['esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes']), titulo: z.string().trim().min(3).max(200), eventoId: z.uuid().nullable().optional() }).strict();
const descartarSchema = z.object({ justificativa: z.string().trim().min(10).max(1000) }).strict();
const minutaSchema = z.object({ minuta: z.string().max(60000), clausulas: z.string().trim().max(2000).nullable().optional() }).strict();
const protocoloSchema = z.object({ numero: z.string().trim().min(2).max(80), quando: instante, comprovante: z.string().trim().max(1000).nullable().optional() }).strict();
const resultadoSchema = z.object({ resultado: z.enum(['deferido', 'parcialmente_deferido', 'indeferido']), observacao: z.string().trim().max(2000).nullable().optional(), quando: instante.nullable().optional() }).strict();
const minutaIaSchema = z.object({ instrucao: z.string().trim().max(3000).nullable().optional() }).strict();
const aprovarStepUp = z.object({ stepUp: z.uuid().nullable().optional() }).strict();
const downloadSchema = z.object({ formato: z.enum(['docx', 'pdf']).default('docx') }).strict();
const filtroSchema = z.object({ acompanhamento: z.uuid().optional(), status: z.string().max(200).optional() }).strict();

// Módulo jurídico (spec fase-10). A API só grava decisões humanas por função do banco; o worker CONFERE as citações contra a base verificada e
// GERA o documento final. O sistema nunca protocola (regra 17): a pessoa protocola e registra o comprovante.
@Controller()
export class JuridicoController {
  constructor(private readonly contexto: ContextoService, private readonly s3: S3Servico) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // ---------------------------------------------------------------- base jurídica
  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/base')
  base(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select b.id, b.tipo, b.numero, b.orgao, b.dispositivo, b.titulo, b.ementa, b.data_ato::text as "dataAto", b.link_oficial as "linkOficial", b.verificada_em as "verificadaEm", u.nome as "verificadaPor"
        from priv.base_juridica b left join core.usuarios u on u.id = b.verificada_por where b.empresa_id = ${empresa}::uuid and b.deleted_at is null order by b.tipo, b.titulo limit 1000`.execute(tx)).rows);
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/base')
  @HttpCode(201)
  async cadastrarBase(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(baseSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.cadastrar_base_juridica(${empresa}::uuid, ${d.tipo}, ${d.numero ?? null}, ${d.orgao ?? null}, ${d.dispositivo ?? null}, ${d.titulo}, ${d.ementa ?? null}, ${d.dataAto ?? null}::date, ${d.linkOficial}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('juridico', 'aprovar_peca')
  @Post('empresas/:empresa/juridico/base/:id/verificar')
  @HttpCode(204)
  async verificarBase(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.verificar_base_juridica(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Delete('empresas/:empresa/juridico/base/:id')
  @HttpCode(204)
  async removerBase(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.remover_base_juridica(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  // ---------------------------------------------------------------- peças
  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/pecas')
  pecas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(filtroSchema, consulta);
    const status = f.status ? f.status.split(',') : null;
    return this.q(req, async (tx) => (await sql`
      select p.id, p.tipo, p.titulo, p.status, p.acompanhamento_id as "acompanhamentoId", p.evento_id as "eventoId", ev.data_limite_legal as "prazoLegal", ev.data_interna_recomendada as "prazoInterno", ev.status as "statusEvento",
             p.bloqueada, p.validada_em as "validadaEm", p.protocolo_numero as "protocoloNumero", p.protocolado_em as "protocoladoEm", p.resultado, p.created_at as "criadaEm", g.razao_social as orgao, e.numero_edital as "numeroEdital"
        from priv.pecas p join priv.acompanhamentos a on a.id = p.acompanhamento_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id left join priv.agenda_eventos ev on ev.id = p.evento_id
       where p.empresa_id = ${empresa}::uuid and (${f.acompanhamento ?? null}::uuid is null or p.acompanhamento_id = ${f.acompanhamento ?? null}::uuid) and (${status}::text[] is null or p.status = any (${status}::text[]))
       order by case p.status when 'descartada' then 9 when 'respondida' then 8 else 0 end, ev.data_limite_legal nulls last, p.created_at desc limit 300`.execute(tx)).rows);
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/pecas/:id')
  async peca(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => (await sql`
      select p.id, p.tipo, p.titulo, p.status, p.acompanhamento_id as "acompanhamentoId", p.evento_id as "eventoId", (select rt.id from priv.recursos_terceiros rt where rt.peca_id = p.id) as "recursoId", p.minuta, p.clausulas, p.minuta_origem as "minutaOrigem", p.minuta_modelo as "minutaModelo", p.justificativa_descarte as "justificativaDescarte", p.validacao, p.validada_em as "validadaEm", p.bloqueada,
             p.arquivo_sha256 as "arquivoSha256", p.arquivo_chave is not null as "temArquivo", p.arquivo_pdf_chave is not null as "temPdf", p.gerado_em as "geradoEm", p.protocolo_numero as "protocoloNumero", p.protocolado_em as "protocoladoEm",
             p.comprovante, p.resultado, p.resultado_obs as "resultadoObs", p.resultado_em as "resultadoEm", ua.nome as "aprovadoPor", p.aprovado_em as "aprovadoEm", ue.nome as "elaboradoPor",
             ev.data_limite_legal as "prazoLegal", ev.data_interna_recomendada as "prazoInterno", g.razao_social as orgao, e.numero_edital as "numeroEdital"
        from priv.pecas p join priv.acompanhamentos a on a.id = p.acompanhamento_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id left join priv.agenda_eventos ev on ev.id = p.evento_id
        left join core.usuarios ua on ua.id = p.aprovado_por left join core.usuarios ue on ue.id = p.elaborado_por where p.id = ${id}::uuid and p.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0]);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/acompanhamentos/:id/pecas')
  @HttpCode(201)
  async criar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(criarSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.criar_peca(${empresa}::uuid, ${id}::uuid, ${d.tipo}, ${d.titulo}, ${d.eventoId ?? null}::uuid) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/descartar')
  @HttpCode(204)
  async descartar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(descartarSchema, corpo);
    await this.q(req, (tx) => sql`select priv.descartar_peca(${empresa}::uuid, ${id}::uuid, ${d.justificativa})`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Put('empresas/:empresa/juridico/pecas/:id/minuta')
  @HttpCode(202)
  async minuta(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(minutaSchema, corpo);
    await this.q(req, (tx) => sql`select priv.salvar_minuta(${empresa}::uuid, ${id}::uuid, ${d.minuta}, ${d.clausulas ?? null})`.execute(tx));
    return { status: 'conferindo_citacoes' };
  }

  // Minuta pela IA: a API só ENFILEIRA (função do banco); o worker chama o provedor com a chave da empresa. O rascunho nunca avança o fluxo.
  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/minuta-ia')
  @HttpCode(202)
  async pedirMinutaIa(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(minutaIaSchema, corpo ?? {});
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.pedir_minuta_peca(${empresa}::uuid, ${id}::uuid, ${d.instrucao ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'pendente' };
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/pecas/:id/minuta-ia')
  async minutaIa(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select id, status, modelo, prompt_versao as "promptVersao", tokens_entrada as "tokensEntrada", tokens_saida as "tokensSaida", referencias_ok as "fontesUsadas",
             citacoes_fora_da_base as "citacoesForaDaBase", erro, created_at as "pedidoEm", concluida_em as "concluidaEm"
        from priv.pecas_ia where peca_id = ${id}::uuid and empresa_id = ${empresa}::uuid order by created_at desc limit 5`.execute(tx)).rows);
  }

  @Permissao('juridico', 'visualizar')
  @Post('empresas/:empresa/juridico/pecas/:id/validar')
  @HttpCode(202)
  async revalidar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.revalidar_peca(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'conferindo_citacoes' };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/revisao')
  @HttpCode(204)
  async revisao(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.enviar_revisao_peca(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('juridico', 'aprovar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/devolver')
  @HttpCode(204)
  async devolver(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.devolver_peca(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('juridico', 'aprovar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/aprovar')
  @HttpCode(202)
  async aprovar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(aprovarStepUp, corpo ?? {});
    // Aprovar exige reautenticação (step-up 'aprovar_peca'); o banco confere o token (ou dispensa só na chave de desenvolvimento, ADR-021).
    await this.q(req, (tx) => sql`select priv.aprovar_peca(${empresa}::uuid, ${id}::uuid, ${d.stepUp ?? null}::uuid)`.execute(tx));
    return { status: 'gerando_documento' };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/protocolo')
  @HttpCode(204)
  async protocolar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(protocoloSchema, corpo);
    await this.q(req, (tx) => sql`select priv.protocolar_peca(${empresa}::uuid, ${id}::uuid, ${d.numero}, ${d.quando}::timestamptz, ${d.comprovante ?? null})`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pecas/:id/resultado')
  @HttpCode(204)
  async resultado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(resultadoSchema, corpo);
    await this.q(req, (tx) => sql`select priv.registrar_resultado_peca(${empresa}::uuid, ${id}::uuid, ${d.resultado}, ${d.observacao ?? null}, ${d.quando ?? null}::timestamptz)`.execute(tx));
  }

  @Permissao('juridico', 'visualizar')
  @Post('empresas/:empresa/juridico/pecas/:id/pdf')
  @HttpCode(202)
  async pedirPdf(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.pedir_pdf_peca(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'gerando_pdf' };
  }

  @Permissao('juridico', 'visualizar')
  @Post('empresas/:empresa/juridico/pecas/:id/download')
  @HttpCode(200)
  async baixar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { formato } = validar(downloadSchema, corpo ?? {});
    const r = await this.q(req, async (tx) => (await sql<{ chave: string | null; pdf: string | null; tipo: string }>`
      select arquivo_chave as chave, arquivo_pdf_chave as pdf, tipo from priv.pecas where id = ${id}::uuid and empresa_id = ${empresa}::uuid and status in ('final', 'protocolada', 'respondida') and arquivo_chave is not null`.execute(tx)).rows[0]);
    const chave = formato === 'pdf' ? r?.pdf : r?.chave;
    if (!r || !chave) throw new NotFoundException();
    try {
      return { url: await this.s3.urlParaBaixar(chave, `${r.tipo}.${formato}`), expiraEmSegundos: 60 };
    } catch {
      throw new ServiceUnavailableException('Armazenamento indisponível.');
    }
  }
}
