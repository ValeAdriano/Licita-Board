import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const abrirSchema = z.object({ concorrente: z.string().trim().min(2).max(200), texto: z.string().trim().max(60000).nullable().optional() }).strict();
const achadoSchema = z.object({
  tipo: z.enum(['certidao', 'economico_financeiro', 'atestado', 'signatario', 'me_epp', 'produto_tecnico', 'proposta', 'inexequibilidade', 'outro']),
  descricao: z.string().trim().min(3).max(600), citacaoConcorrente: z.string().trim().max(1500).nullable().optional(), citacaoEdital: z.string().trim().max(1500).nullable().optional(),
  prova: z.string().trim().max(1000).nullable().optional(), fundamento: z.string().trim().max(500).nullable().optional(), classificacao: z.enum(['forte', 'moderada', 'fraca']).nullable().optional(),
}).strict();
const recomendacaoSchema = z.object({ recomendacao: z.enum(['recorrer', 'nao_recorrer', 'apenas_registrar']), justificativa: z.string().trim().min(10).max(1000) }).strict();

// Parecer de viabilidade recursal (spec fase-10, 10.4/10.5). A API só grava por função do banco; o worker confere a EVIDÊNCIA (código puro) e a
// IA, se houver chave, apenas SUGERE achados com citação literal. A recomendação é humana. Nunca protocola (regra 17).
@Controller()
export class PareceresController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // Itens em que a empresa não foi a primeira colocada (gatilho recursal), com a situação do parecer.
  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/pareceres')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select r.participacao_id as "participacaoId", r.resultado_final as resultado, r.vencedora_nome as "vencedoraNome", r.ocorrido_em as "ocorridoEm", i.numero_item as "numeroItem", left(i.descricao, 200) as item,
             e.numero_edital as "numeroEdital", g.razao_social as orgao, pr.id as "parecerId", pr.recomendacao, pr.bloqueado, pr.analise_status as "analiseStatus", pr.peca_id as "pecaId",
             (select count(*)::int from priv.parecer_achados a where a.parecer_id = pr.id) as achados
        from priv.resultados_item r join priv.participacoes pa on pa.id = r.participacao_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id
        left join pub.edital_itens i on i.id = pa.item_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
        left join priv.pareceres_recursais pr on pr.participacao_id = r.participacao_id
       where r.empresa_id = ${empresa}::uuid and r.gatilho_recursal order by r.ocorrido_em desc limit 200`.execute(tx)).rows);
  }

  @Permissao('juridico', 'visualizar')
  @Get('empresas/:empresa/juridico/pareceres/participacao/:participacao')
  async detalhe(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('participacao', new ParseUUIDPipe()) participacao: string) {
    const r = await this.q(req, async (tx) => {
      const res = (await sql`
        select r.resultado_final as resultado, r.vencedora_nome as "vencedoraNome", r.vencedora_marca_modelo as "vencedoraMarcaModelo", r.motivo_perda as motivo, r.gatilho_recursal as "gatilhoRecursal",
               i.numero_item as "numeroItem", left(i.descricao, 200) as item, e.numero_edital as "numeroEdital", g.razao_social as orgao
          from priv.resultados_item r join priv.participacoes pa on pa.id = r.participacao_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id
          left join pub.edital_itens i on i.id = pa.item_id left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
         where r.participacao_id = ${participacao}::uuid and r.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0];
      if (!res) return null;
      const parecer = (await sql`
        select id, concorrente, texto_concorrente as texto, recomendacao, recomendacao_justificativa as "recomendacaoJustificativa", recomendada_em as "recomendadaEm", validacao, validada_em as "validadaEm", bloqueado,
               analise_status as "analiseStatus", analise_erro as "analiseErro", analise_modelo as "analiseModelo", peca_id as "pecaId"
          from priv.pareceres_recursais where participacao_id = ${participacao}::uuid and empresa_id = ${empresa}::uuid`.execute(tx)).rows[0];
      const achados = parecer ? (await sql`
        select id, ordem, origem, tipo, descricao, citacao_concorrente as "citacaoConcorrente", concorrente_confere as "concorrenteConfere", citacao_edital as "citacaoEdital", edital_confere as "editalConfere",
               pagina_edital as "paginaEdital", prova, fundamento, classificacao
          from priv.parecer_achados where parecer_id = ${(parecer as { id: string }).id}::uuid and empresa_id = ${empresa}::uuid order by ordem`.execute(tx)).rows : [];
      return { resultado: res, parecer: parecer ?? null, achados };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pareceres/participacao/:participacao')
  @HttpCode(201)
  async abrir(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('participacao', new ParseUUIDPipe()) participacao: string, @Body() corpo: unknown) {
    const d = validar(abrirSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.abrir_parecer(${empresa}::uuid, ${participacao}::uuid, ${d.concorrente}, ${d.texto ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pareceres/:id/analisar')
  @HttpCode(202)
  async analisar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.pedir_analise_vencedora(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'pendente' };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pareceres/:id/achados')
  @HttpCode(201)
  async criarAchado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(achadoSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.salvar_achado(${empresa}::uuid, ${id}::uuid, null, ${d.tipo}, ${d.descricao}, ${d.citacaoConcorrente ?? null}, ${d.citacaoEdital ?? null}, ${d.prova ?? null}, ${d.fundamento ?? null}, ${d.classificacao ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id };
  }

  @Permissao('juridico', 'elaborar_peca')
  @Put('empresas/:empresa/juridico/pareceres/:id/achados/:achado')
  @HttpCode(204)
  async editarAchado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Param('achado', new ParseUUIDPipe()) achado: string, @Body() corpo: unknown) {
    const d = validar(achadoSchema, corpo);
    await this.q(req, (tx) => sql`
      select priv.salvar_achado(${empresa}::uuid, ${id}::uuid, ${achado}::uuid, ${d.tipo}, ${d.descricao}, ${d.citacaoConcorrente ?? null}, ${d.citacaoEdital ?? null}, ${d.prova ?? null}, ${d.fundamento ?? null}, ${d.classificacao ?? null})`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Delete('empresas/:empresa/juridico/pareceres/achados/:achado')
  @HttpCode(204)
  async removerAchado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('achado', new ParseUUIDPipe()) achado: string) {
    await this.q(req, (tx) => sql`select priv.remover_achado(${empresa}::uuid, ${achado}::uuid)`.execute(tx));
  }

  @Permissao('juridico', 'aprovar_peca')
  @Put('empresas/:empresa/juridico/pareceres/:id/recomendacao')
  @HttpCode(204)
  async recomendar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(recomendacaoSchema, corpo);
    await this.q(req, (tx) => sql`select priv.registrar_recomendacao(${empresa}::uuid, ${id}::uuid, ${d.recomendacao}, ${d.justificativa})`.execute(tx));
  }

  @Permissao('juridico', 'elaborar_peca')
  @Post('empresas/:empresa/juridico/pareceres/:id/recurso')
  @HttpCode(201)
  async abrirRecurso(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.abrir_peca_recurso(${empresa}::uuid, ${id}::uuid) as id`.execute(tx));
    return { pecaId: r.rows[0]?.id };
  }
}
