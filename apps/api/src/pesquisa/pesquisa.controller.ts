import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { S3Servico } from '../documentos/s3.service.js';

const POR_PAGINA = 30;
const listaSchema = z.object({
  faixa: z.enum(['alta', 'media', 'baixa']).optional(),
  triagem: z.enum(['nova', 'vista', 'interesse', 'descartada_pelo_usuario']).optional(),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
}).strict();
const triagemSchema = z.object({
  triagem: z.enum(['vista', 'interesse', 'descartada_pelo_usuario']), motivo: z.string().trim().max(500).nullable().optional(),
}).strict();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));
const pesquisaSchema = z.object({
  fonte: z.enum(['pncp', 'comprasgov']).default('pncp'), inicio: dia, fim: dia, uf: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
}).strict();
const importacaoSchema = z.object({ url: z.url().max(1000) }).strict();
const buscaSchema = z.object({ q: z.string().trim().min(2).max(120) }).strict();

// Pesquisa de editais (spec fase-04): dado público de licitações (pub, lido por quem tem editais/visualizar em
// alguma empresa — a RLS confere), resultado por empresa (oportunidades, A x B) e ações do usuário. A API NUNCA
// escreve em pub: importação e pesquisa manual viram job; só o worker grava.
@Controller()
export class PesquisaController {
  constructor(
    private readonly contexto: ContextoService,
    private readonly s3: S3Servico,
  ) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // Estado das fontes para o banner: vazio NUNCA aparece sem a última busca bem-sucedida e o estado das fontes.
  @Get('pesquisa/estado')
  estado(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select slug, nome, status, ativa, ultimo_sucesso_em as "ultimoSucessoEm", ultima_pesquisa_em as "ultimaPesquisaEm"
        from ops.estado_das_fontes()`.execute(tx)).rows);
  }

  @Permissao('editais', 'visualizar')
  @Get('empresas/:empresa/oportunidades')
  oportunidades(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(listaSchema, consulta);
    return this.q(req, async (tx) => {
      const filtroFaixa = f.faixa ? sql`and o.faixa = ${f.faixa}` : sql``;
      const filtroTriagem = f.triagem ? sql`and o.triagem = ${f.triagem}` : sql``;
      const itens = (await sql`
        select o.id, o.nota, o.faixa, o.motivos, o.fora_dos_filtros as "foraDosFiltros", o.triagem, o.triagem_motivo as "triagemMotivo",
               i.numero_item as "numeroItem", left(i.descricao, 300) as descricao, i.quantidade::text as quantidade, i.unidade_medida as "unidadeMedida",
               i.valor_total_estimado::text as "valorTotal", i.beneficio,
               e.id as "editalId", left(e.objeto, 300) as objeto, e.modalidade, e.numero_edital as "numeroEdital",
               e.data_encerramento_propostas as "encerramentoPropostas", e.situacao, e.link_origem as "linkOrigem",
               g.razao_social as orgao, g.uf, g.municipio
          from priv.oportunidades o
          join pub.edital_itens i on i.id = o.item_id
          join pub.editais e on e.id = o.edital_id
          join pub.orgaos g on g.id = e.orgao_id
         where o.empresa_id = ${empresa}::uuid and not o.retirado ${filtroFaixa} ${filtroTriagem}
         order by o.nota desc, e.data_publicacao desc nulls last, i.numero_item
         limit ${POR_PAGINA} offset ${(f.pagina - 1) * POR_PAGINA}`.execute(tx)).rows;
      const contagem = (await sql<{ faixa: string; n: string }>`
        select faixa, count(*)::text as n from priv.oportunidades where empresa_id = ${empresa}::uuid and not retirado group by faixa`.execute(tx)).rows;
      return { itens, contagem: Object.fromEntries(contagem.map((c) => [c.faixa, Number(c.n)])), pagina: f.pagina, porPagina: POR_PAGINA };
    });
  }

  @Permissao('editais', 'editar')
  @Post('empresas/:empresa/oportunidades/:id/triagem')
  @HttpCode(204)
  async triar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(triagemSchema, corpo);
    await this.q(req, (tx) => sql`select priv.triar_oportunidade(${empresa}::uuid, ${id}::uuid, ${d.triagem}, ${d.motivo ?? null})`.execute(tx));
  }

  // Edital público com itens, arquivos e versões. Sem permissão a RLS devolve vazio: 404, sem revelar nada.
  @Get('editais/:id')
  async edital(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const e = (await sql`
        select e.id, e.id_externo as "idExterno", e.numero_edital as "numeroEdital", e.processo, e.modalidade, e.modo_disputa as "modoDisputa",
               e.criterio_julgamento as "criterioJulgamento", e.srp, e.objeto, e.valor_estimado::text as "valorEstimado", e.situacao,
               e.data_publicacao as "dataPublicacao", e.data_abertura_propostas as "dataAberturaPropostas",
               e.data_encerramento_propostas as "dataEncerramentoPropostas", e.link_origem as "linkOrigem", e.link_portal as "linkPortal",
               e.versao_atual as "versaoAtual", e.origem, e.ultima_coleta_em as "ultimaColetaEm",
               g.razao_social as orgao, g.uf, g.municipio, g.cnpj
          from pub.editais e join pub.orgaos g on g.id = e.orgao_id where e.id = ${id}::uuid`.execute(tx)).rows[0];
      if (!e) return null;
      const itens = (await sql`
        select id, numero_item as "numeroItem", descricao, quantidade::text as quantidade, unidade_medida as "unidadeMedida",
               valor_unitario_estimado::text as "valorUnitario", valor_total_estimado::text as "valorTotal", beneficio, situacao,
               versao_final is not null as retirado
          from pub.edital_itens where edital_id = ${id}::uuid and tipo = 'item' order by numero_item limit 2000`.execute(tx)).rows;
      const arquivos = (await sql`
        select id, tipo, titulo, url_origem as "urlOrigem", coletado_em as "coletadoEm", tamanho::text as tamanho, sha256, tipo_real as "tipoReal",
               status_arquivo as "statusArquivo", motivo, paginas, status_extracao as "statusExtracao"
          from pub.edital_arquivos where edital_id = ${id}::uuid order by tipo, titulo`.execute(tx)).rows;
      const versoes = (await sql`
        select versao, coletada_em as "coletadaEm", campos_alterados as "camposAlterados"
          from pub.edital_versoes where edital_id = ${id}::uuid order by versao desc`.execute(tx)).rows;
      return { ...e, itens, arquivos, versoes };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  // Busca no texto extraído: cada resultado aponta o arquivo e a página de origem (Prompt 4.5).
  @Get('editais/:id/trechos')
  trechos(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string, @Query() consulta: unknown) {
    const b = validar(buscaSchema, consulta);
    return this.q(req, async (tx) => (await sql`
      select t.id, t.arquivo_id as "arquivoId", a.titulo as "arquivoTitulo", t.pagina, t.origem_extracao as "origemExtracao",
             left(t.texto, 600) as texto
        from pub.trechos t join pub.edital_arquivos a on a.id = t.arquivo_id
       where t.edital_id = ${id}::uuid and t.tsv @@ websearch_to_tsquery('pub.pt_unaccent', ${b.q})
       order by ts_rank(t.tsv, websearch_to_tsquery('pub.pt_unaccent', ${b.q})) desc, t.pagina limit 30`.execute(tx)).rows);
  }

  // Download: permissão e arquivo liberado conferidos no banco, que REGISTRA quem baixou; a URL vale 60 s.
  @Post('editais/arquivos/:aid/download')
  @HttpCode(200)
  async baixar(@Req() req: RequisicaoVV, @Param('aid', new ParseUUIDPipe()) aid: string) {
    const r = await this.q(req, async (tx) => {
      const chave = (await sql<{ k: string }>`select pub.registrar_download_edital(${aid}::uuid) as k`.execute(tx)).rows[0]?.k;
      const nome = (await sql<{ n: string | null }>`select titulo as n from pub.edital_arquivos where id = ${aid}::uuid`.execute(tx)).rows[0]?.n;
      return { chave, nome: nome ?? 'edital' };
    });
    if (!r.chave) throw new NotFoundException();
    return { url: await this.s3.urlParaBaixar(r.chave, r.nome), expiraEmSegundos: 60 };
  }

  // Pesquisa manual sob demanda: vira execução `manual` + job; o resultado aparece em Oportunidades.
  @Permissao('editais', 'cadastrar')
  @Post('empresas/:empresa/pesquisas')
  @HttpCode(202)
  async pesquisar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(pesquisaSchema, corpo);
    const r = await this.q(req, async (tx) => (await sql<{ id: string }>`
      select ops.solicitar_coleta_manual(${empresa}::uuid, ${d.fonte}, ${d.inicio}::date, ${d.fim}::date, ${d.uf ?? null}) as id`.execute(tx)).rows[0]);
    return { execucaoId: r?.id, status: 'enfileirada' };
  }

  @Permissao('editais', 'cadastrar')
  @Post('empresas/:empresa/importacoes')
  @HttpCode(202)
  async importar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(importacaoSchema, corpo);
    const r = await this.q(req, async (tx) => (await sql<{ id: string }>`
      select priv.solicitar_importacao(${empresa}::uuid, 'url', ${d.url}, null) as id`.execute(tx)).rows[0]);
    return { importacaoId: r?.id, status: 'pendente' };
  }

  @Permissao('editais', 'visualizar')
  @Get('empresas/:empresa/importacoes')
  importacoes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, tipo, url, status, edital_id as "editalId", erro, created_at as "criadaEm"
        from priv.importacoes where empresa_id = ${empresa}::uuid order by created_at desc limit 50`.execute(tx)).rows);
  }

  // ---- Plataforma (SUPERADMIN): painel de cobertura e falhas (Prompt 4.9). A RLS de ops.* já restringe;
  // o teste explícito devolve 403 em vez de lista vazia que pareceria "tudo bem".
  private async soSuperadmin(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<unknown>) {
    return this.q(req, async (tx) => {
      const ok = (await sql<{ s: boolean }>`select core.is_superadmin() as s`.execute(tx)).rows[0]?.s;
      if (!ok) throw new ForbiddenException();
      return fn(tx);
    });
  }

  @Get('plataforma/pesquisa/cobertura')
  cobertura(@Req() req: RequisicaoVV) {
    return this.soSuperadmin(req, async (tx) => {
      const fontes = (await sql`
        select f.id, f.slug, f.nome, f.status, f.ativa, f.falhas_consecutivas as "falhasConsecutivas", f.ultimo_sucesso_em as "ultimoSucessoEm",
               f.ultima_pesquisa_em as "ultimaPesquisaEm", f.ultimo_resultado as "ultimoResultado", f.horarios,
               (select count(*)::int from ops.fonte_checagens c where c.fonte_id = f.id and c.em > now() - interval '7 days' and c.ok) as "checagensOk7d",
               (select count(*)::int from ops.fonte_checagens c where c.fonte_id = f.id and c.em > now() - interval '7 days' and not c.ok) as "checagensFalha7d"
          from ops.fontes f order by f.slug`.execute(tx)).rows;
      const execucoes = (await sql`
        select e.id, f.slug as fonte, e.tipo, e.status, e.agendada_para as "agendadaPara", e.iniciada_em as "iniciadaEm", e.concluida_em as "concluidaEm",
               e.processos_encontrados as "processosEncontrados", e.editais_novos as "editaisNovos", e.editais_atualizados as "editaisAtualizados",
               e.itens_pendentes as "itensPendentes", e.erro_tipo as "erroTipo"
          from ops.execucoes e join ops.fontes f on f.id = e.fonte_id order by e.agendada_para desc limit 50`.execute(tx)).rows;
      const totais = (await sql`
        select (select count(*)::int from pub.editais) as editais,
               (select count(*)::int from pub.edital_itens where tipo = 'item') as itens,
               (select count(*)::int from pub.edital_arquivos) as arquivos,
               (select count(*)::int from pub.edital_arquivos where status_arquivo = 'liberado') as "arquivosLiberados",
               (select count(*)::int from pub.edital_arquivos where status_arquivo in ('pendente', 'quarentena')) as "arquivosPendentes",
               (select count(*)::int from pub.edital_arquivos where status_arquivo in ('bloqueado', 'grande_demais', 'falhou')) as "arquivosComProblema",
               (select count(*)::int from pub.edital_arquivos where status_extracao in ('ok', 'ocr', 'parcial')) as "arquivosProcessados",
               (select count(*)::int from pub.trechos) as trechos`.execute(tx)).rows[0];
      const cobertura = (await sql`
        select a.mes_referencia::text as mes, count(*)::int as total,
               count(*) filter (where r.encontrado)::int as encontrados
          from ops.amostra_cobertura a
          left join lateral (select encontrado from ops.cobertura_resultados x where x.amostra_id = a.id order by x.apurado_em desc limit 1) r on true
         group by a.mes_referencia order by a.mes_referencia desc limit 12`.execute(tx)).rows;
      return { fontes, execucoes, totais, cobertura, amostraMedida: cobertura.length > 0 };
    });
  }
}
