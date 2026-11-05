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
const criarSchema = dadosSchema.extend({ tipo: z.enum(['inicial', 'final']).default('inicial') }).strict();

// Propostas (spec fase-08). A API só grava decisões humanas por função do banco; o worker VALIDA (8.6) e GERA o documento final com
// hash. O sistema nunca envia ao portal (regra 17): a pessoa autorizada baixa o arquivo e registra o comprovante.
@Controller()
export class PropostasController {
  constructor(private readonly contexto: ContextoService, private readonly s3: S3Servico) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('propostas', 'visualizar')
  @Get('empresas/:empresa/acompanhamentos/:id/propostas')
  propostas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => {
      const lista = (await sql`
        select p.id, p.versao, p.tipo, p.status, p.representante_id as "representanteId", r.nome as representante, p.validade_dias as "validadeDias", p.prazo_entrega_dias as "prazoEntregaDias",
               p.garantia_meses as "garantiaMeses", p.condicoes, p.local_assinatura as local, p.conteudo, p.total::text as total, p.total_extenso as "totalExtenso", p.validacao,
               p.validada_em as "validadaEm", p.bloqueada, p.arquivo_sha256 as "arquivoSha256", p.gerado_em as "geradoEm", p.arquivo_chave is not null as "temArquivo",
               uc.nome as "conferidoPor", p.conferido_em as "conferidoEm", ua.nome as "aprovadoPor", p.aprovado_em as "aprovadoEm", p.created_at as "criadaEm"
          from priv.propostas p left join core.representantes r on r.id = p.representante_id left join core.usuarios uc on uc.id = p.conferido_por left join core.usuarios ua on ua.id = p.aprovado_por
         where p.acompanhamento_id = ${id}::uuid and p.empresa_id = ${empresa}::uuid and p.deleted_at is null order by p.versao desc`.execute(tx)).rows;
      const representantes = (await sql`select id, nome, tipo from core.representantes where empresa_id = ${empresa}::uuid and ativo and deleted_at is null order by nome limit 200`.execute(tx)).rows;
      return { propostas: lista, representantes };
    });
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
  async aprovar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.aprovar_proposta(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'gerando_documento' };
  }

  @Permissao('propostas', 'cadastrar')
  @Post('empresas/:empresa/propostas/:id/nova-versao')
  @HttpCode(201)
  async novaVersao(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql<{ id: string }>`select priv.nova_versao_proposta(${empresa}::uuid, ${id}::uuid) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'validando' };
  }

  // Download do documento final: permissão e propostas da própria empresa conferidos no banco; a URL vale 60 s.
  @Permissao('propostas', 'visualizar')
  @Post('empresas/:empresa/propostas/:id/download')
  @HttpCode(200)
  async baixar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, async (tx) => (await sql<{ chave: string; versao: number }>`
      select arquivo_chave as chave, versao from priv.propostas where id = ${id}::uuid and empresa_id = ${empresa}::uuid and status = 'final' and arquivo_chave is not null`.execute(tx)).rows[0]);
    if (!r) throw new NotFoundException();
    try {
      return { url: await this.s3.urlParaBaixar(r.chave, `proposta-v${String(r.versao)}.docx`), expiraEmSegundos: 60 };
    } catch {
      throw new ServiceUnavailableException('Armazenamento indisponível.');
    }
  }
}
