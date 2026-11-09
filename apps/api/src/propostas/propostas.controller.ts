import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { S3Servico } from '../documentos/s3.service.js';

const dadosSchema = z.object({
  representanteId: z.uuid().nullable().optional(), validadeDias: z.number().int().min(1).max(3650).nullable().optional(), prazoEntregaDias: z.number().int().min(1).max(3650).nullable().optional(),
  garantiaMeses: z.number().int().min(1).max(600).nullable().optional(), condicoes: z.string().trim().max(2000).nullable().optional(), local: z.string().trim().max(120).nullable().optional(),
}).strict();
const aprovarStepUp = z.object({ stepUp: z.uuid().nullable().optional() }).strict();
const downloadSchema = z.object({ formato: z.enum(['docx', 'pdf']).default('docx') }).strict();
const criarSchema = dadosSchema.extend({ tipo: z.enum(['inicial', 'final']).default('inicial') }).strict();
const isoComFuso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/).refine((s) => !Number.isNaN(Date.parse(s)));
const registrarEnvioSchema = z.object({
  enviadoEm: isoComFuso,
  formato: z.enum(['docx', 'pdf', 'outro']),
  portal: z.string().trim().max(120).nullable().optional(),
  identificadorPortal: z.string().trim().max(120).nullable().optional(),
  tipoComprovante: z.string().trim().max(120).nullable().optional(),
  representanteId: z.uuid().nullable().optional(),
  documentoId: z.uuid(),
  observacao: z.string().trim().max(1000).nullable().optional(),
}).strict();
const anularEnvioSchema = z.object({ motivo: z.string().trim().min(10).max(1000) }).strict();

// Propostas (spec fase-08). A API só grava decisões humanas por função do banco; o worker VALIDA (8.6) e GERA o documento final com
// hash. O sistema nunca envia ao portal (regra 17): a pessoa autorizada baixa o arquivo e registra o comprovante.
@Controller()
export class PropostasController {
  constructor(private readonly contexto: ContextoService, private readonly s3: S3Servico) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  private async avisosDoEnvio(tx: Transaction<Database>, empresa: string, envioId: string): Promise<string[]> {
    const r = (await sql<{ apos: boolean; naoUltima: boolean; naoLiberado: boolean }>`
      select (coalesce(e.data_encerramento_propostas, a.data_abertura) is not null
              and pe.enviado_em > coalesce(e.data_encerramento_propostas, a.data_abertura)) as apos,
             exists (
               select 1 from priv.propostas p2
                where p2.acompanhamento_id = p.acompanhamento_id and p2.empresa_id = p.empresa_id
                  and p2.status = 'final' and p2.deleted_at is null and p2.versao > pe.proposta_versao
             ) as "naoUltima",
             coalesce(dv.status_arquivo <> 'liberado', false) as "naoLiberado"
        from priv.proposta_envios pe
        join priv.propostas p on p.id = pe.proposta_id and p.empresa_id = pe.empresa_id
        join priv.acompanhamentos a on a.id = p.acompanhamento_id and a.empresa_id = p.empresa_id
        join pub.editais e on e.id = a.edital_id
        left join priv.documento_versoes dv on dv.id = pe.comprovante_versao_id and dv.empresa_id = pe.empresa_id
       where pe.id = ${envioId}::uuid and pe.empresa_id = ${empresa}::uuid`.execute(tx)).rows[0];
    const avisos: string[] = [];
    if (r?.apos) avisos.push('envio_apos_encerramento');
    if (r?.naoUltima) avisos.push('versao_nao_ultima_final');
    if (r?.naoLiberado) avisos.push('comprovante_nao_liberado');
    return avisos;
  }

  @Permissao('propostas', 'visualizar')
  @Get('empresas/:empresa/acompanhamentos/:id/propostas')
  propostas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => {
      const lista = (await sql`
        select p.id, p.versao, p.tipo, p.status, p.representante_id as "representanteId", r.nome as representante, p.validade_dias as "validadeDias", p.prazo_entrega_dias as "prazoEntregaDias",
               p.garantia_meses as "garantiaMeses", p.condicoes, p.local_assinatura as local, p.conteudo, p.total::text as total, p.total_extenso as "totalExtenso", p.validacao,
               p.validada_em as "validadaEm", p.bloqueada, p.arquivo_sha256 as "arquivoSha256", p.gerado_em as "geradoEm", p.arquivo_chave is not null as "temArquivo", p.arquivo_pdf_chave is not null as "temPdf",
               uc.nome as "conferidoPor", p.conferido_em as "conferidoEm", ua.nome as "aprovadoPor", p.aprovado_em as "aprovadoEm", p.created_at as "criadaEm",
               (select jsonb_build_object(
                  'id', pe.id,
                  'enviadoEm', pe.enviado_em,
                  'formato', pe.formato,
                  'portal', pe.portal,
                  'identificadorPortal', pe.identificador_portal,
                  'registradoEm', pe.registrado_em
                )
                  from priv.proposta_envios pe
                 where pe.proposta_id = p.id and pe.empresa_id = p.empresa_id and pe.anulado_em is null and pe.deleted_at is null
                 order by pe.registrado_em desc limit 1) as "ultimoEnvio"
          from priv.propostas p left join core.representantes r on r.id = p.representante_id left join core.usuarios uc on uc.id = p.conferido_por left join core.usuarios ua on ua.id = p.aprovado_por
         where p.acompanhamento_id = ${id}::uuid and p.empresa_id = ${empresa}::uuid and p.deleted_at is null order by p.versao desc`.execute(tx)).rows;
      const representantes = (await sql`select id, nome, tipo from core.representantes where empresa_id = ${empresa}::uuid and ativo and deleted_at is null order by nome limit 200`.execute(tx)).rows;
      const ac = (await sql<{ portal: string | null }>`select portal from priv.acompanhamentos where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx)).rows[0];
      return { propostas: lista, representantes, portal: ac?.portal ?? null };
    });
  }

  @Permissao('propostas', 'visualizar')
  @Get('empresas/:empresa/propostas/:id/envios')
  async listarEnvios(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => {
      const prop = (await sql<{ id: string }>`select id from priv.propostas where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx)).rows[0];
      if (!prop) return null;
      const linhas = (await sql<{
        id: string; propostaVersao: number; formato: string; propostaSha256: string | null; enviadoEm: string;
        portal: string | null; identificadorPortal: string | null; tipoComprovante: string | null;
        representanteId: string | null; representante: string | null;
        comprovante: { documentoId: string; versaoId: string; nome: string; status: string } | null;
        observacao: string | null; registradoEm: string; registradoPor: { nome: string | null };
        anulado: { em: string; por: string | null; motivo: string } | null;
      }>`
        select pe.id, pe.proposta_versao as "propostaVersao", pe.formato, pe.proposta_sha256 as "propostaSha256",
               pe.enviado_em as "enviadoEm", pe.portal, pe.identificador_portal as "identificadorPortal",
               pe.tipo_comprovante as "tipoComprovante", pe.representante_id as "representanteId", rp.nome as representante,
               case
                 when core.has_permission(pe.empresa_id, 'documentos', 'visualizar') and dv.id is not null then
                   jsonb_build_object('documentoId', pe.comprovante_documento_id, 'versaoId', dv.id, 'nome', dv.nome_original, 'status', dv.status_arquivo)
                 else null
               end as comprovante,
               pe.observacao, pe.registrado_em as "registradoEm",
               jsonb_build_object('nome', ur.nome) as "registradoPor",
               case
                 when pe.anulado_em is not null then jsonb_build_object('em', pe.anulado_em, 'por', ua.nome, 'motivo', pe.anulado_motivo)
                 else null
               end as anulado
          from priv.proposta_envios pe
          left join priv.documento_versoes dv on dv.id = pe.comprovante_versao_id and dv.empresa_id = pe.empresa_id
          left join core.representantes rp on rp.id = pe.representante_id
          left join core.usuarios ur on ur.id = pe.registrado_por
          left join core.usuarios ua on ua.id = pe.anulado_por
         where pe.proposta_id = ${id}::uuid and pe.empresa_id = ${empresa}::uuid and pe.deleted_at is null
         order by pe.registrado_em desc`.execute(tx)).rows;
      const envios = [];
      for (const l of linhas) {
        envios.push({ ...l, avisos: await this.avisosDoEnvio(tx, empresa, l.id) });
      }
      return { envios };
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Permissao('propostas', 'aprovar')
  @Post('empresas/:empresa/propostas/:id/envios')
  @HttpCode(201)
  async registrarEnvio(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(registrarEnvioSchema, corpo);
    return this.q(req, async (tx) => {
      const r = await sql<{ id: string }>`
        select priv.registrar_envio_proposta(
          ${empresa}::uuid, ${id}::uuid, ${d.enviadoEm}::timestamptz, ${d.formato},
          ${d.portal ?? null}, ${d.identificadorPortal ?? null}, ${d.documentoId}::uuid,
          ${d.observacao ?? null}, ${d.tipoComprovante ?? null}, ${d.representanteId ?? null}::uuid
        ) as id`.execute(tx);
      const envioId = r.rows[0]?.id ?? '';
      const avisos = await this.avisosDoEnvio(tx, empresa, envioId);
      return { id: envioId, avisos };
    });
  }

  @Permissao('propostas', 'aprovar')
  @Post('empresas/:empresa/proposta-envios/:id/anular')
  @HttpCode(204)
  async anularEnvio(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(anularEnvioSchema, corpo);
    await this.q(req, (tx) => sql`select priv.anular_envio_proposta(${empresa}::uuid, ${id}::uuid, ${d.motivo})`.execute(tx));
  }

  @Permissao('propostas', 'cadastrar')
  @Post('empresas/:empresa/acompanhamentos/:id/propostas')
  @HttpCode(201)
  async criar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(criarSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.criar_proposta(${empresa}::uuid, ${id}::uuid, ${d.representanteId ?? null}::uuid, ${d.tipo}, ${d.validadeDias ?? null}::int,
      ${d.prazoEntregaDias ?? null}::int, ${d.garantiaMeses ?? null}::int, ${d.condicoes ?? null}, ${d.local ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'validando' };
  }

  @Permissao('propostas', 'cadastrar')
  @Post('empresas/:empresa/propostas/:id/dados')
  @HttpCode(202)
  async dados(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(dadosSchema, corpo);
    await this.q(req, (tx) => sql`select priv.salvar_proposta(${empresa}::uuid, ${id}::uuid, ${d.representanteId ?? null}::uuid, ${d.validadeDias ?? null}::int, ${d.prazoEntregaDias ?? null}::int,
      ${d.garantiaMeses ?? null}::int, ${d.condicoes ?? null}, ${d.local ?? null})`.execute(tx));
    return { status: 'validando' };
  }

  @Permissao('propostas', 'cadastrar')
  @Post('empresas/:empresa/propostas/:id/validar')
  @HttpCode(202)
  async revalidar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.revalidar_proposta(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'validando' };
  }

  @Permissao('propostas', 'editar')
  @Post('empresas/:empresa/propostas/:id/conferir')
  @HttpCode(204)
  async conferir(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.conferir_proposta(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('propostas', 'editar')
  @Post('empresas/:empresa/propostas/:id/devolver')
  @HttpCode(204)
  async devolver(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.devolver_proposta(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('propostas', 'aprovar')
  @Post('empresas/:empresa/propostas/:id/aprovar')
  @HttpCode(202)
  async aprovar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(aprovarStepUp, corpo ?? {});
    // A proposta final exige reautenticação (step-up 'proposta_final'); o banco confere o token.
    await this.q(req, (tx) => sql`select priv.aprovar_proposta(${empresa}::uuid, ${id}::uuid, ${d.stepUp ?? null}::uuid)`.execute(tx));
    return { status: 'gerando_documento' };
  }

  @Permissao('propostas', 'cadastrar')
  @Post('empresas/:empresa/propostas/:id/nova-versao')
  @HttpCode(201)
  async novaVersao(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.nova_versao_proposta(${empresa}::uuid, ${id}::uuid) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'validando' };
  }

  // Download do documento final (.docx ou PDF): permissão e propostas da própria empresa conferidos no banco; a URL vale 60 s.
  @Permissao('propostas', 'visualizar')
  @Post('empresas/:empresa/propostas/:id/download')
  @HttpCode(200)
  async baixar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { formato } = validar(downloadSchema, corpo ?? {});
    const r = await this.q(req, async (tx) => (await sql<{ chave: string | null; pdf: string | null; versao: number }>`
      select arquivo_chave as chave, arquivo_pdf_chave as pdf, versao from priv.propostas where id = ${id}::uuid and empresa_id = ${empresa}::uuid and status = 'final' and arquivo_chave is not null`.execute(tx)).rows[0]);
    const chave = formato === 'pdf' ? r?.pdf : r?.chave;
    if (!r || !chave) throw new NotFoundException();
    try {
      return { url: await this.s3.urlParaBaixar(chave, `proposta-v${String(r.versao)}.${formato}`), expiraEmSegundos: 60 };
    } catch {
      throw new ServiceUnavailableException('Armazenamento indisponível.');
    }
  }

  // Pede o PDF de uma proposta final que ainda não o tem (o worker converte; o conteúdo da final não muda).
  @Permissao('propostas', 'visualizar')
  @Post('empresas/:empresa/propostas/:id/pdf')
  @HttpCode(202)
  async pedirPdf(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.pedir_pdf_proposta(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'gerando_pdf' };
  }
}
