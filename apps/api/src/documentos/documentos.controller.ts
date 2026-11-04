import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { S3Servico } from './s3.service.js';

const TAMANHO_MAXIMO = 25 * 1024 * 1024;
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));
const novoSchema = z.object({
  tipoId: z.uuid(), descricao: z.string().trim().min(2).max(300), numero: z.string().trim().max(80).nullable().optional(),
  emissor: z.string().trim().max(200).nullable().optional(), origem: z.string().trim().max(200).nullable().optional(),
  semVencimento: z.boolean().optional(),
}).strict();
const versaoSchema = z.object({
  nome: z.string().trim().min(1).max(255), tamanho: z.number().int().min(1).max(TAMANHO_MAXIMO),
  emissao: dia.nullable().optional(), validade: dia.nullable().optional(),
}).strict();

// Repositório documental (spec fase-03). O arquivo NUNCA passa pela API: ela cria a versão em quarentena
// no banco (permissão conferida lá), assina o PUT e, depois, o download de 60 s. Quem libera o arquivo é
// o worker, depois do antivírus, do tipo real e do SHA-256.
@Controller()
export class DocumentosController {
  constructor(
    private readonly contexto: ContextoService,
    private readonly s3: S3Servico,
  ) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // Pastas e tipos: não são dado de empresa.
  @Get('documentos/tipos')
  tipos(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, slug, nome, pasta, exige_validade as "exigeValidade", antecedencias, emissor_url as "emissorUrl"
        from pub.tipos_documento order by ordem`.execute(tx)).rows);
  }

  @Permissao('documentos', 'visualizar')
  @Get('empresas/:empresa/documentos')
  lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select d.id, d.tipo_id as "tipoId", d.descricao, d.numero, d.emissor, d.sem_vencimento as "semVencimento",
             s.status, s.validade::text as validade, s.versao_id as "versaoAtualId"
        from priv.documentos d join priv.documentos_status s on s.documento_id = d.id
       where d.empresa_id = ${empresa}::uuid and d.deleted_at is null
       order by case s.status when 'vencido' then 0 when 'a_vencer' then 1 when 'pendente' then 2 else 3 end, d.descricao`.execute(tx)).rows);
  }

  @Permissao('documentos', 'cadastrar')
  @Post('empresas/:empresa/documentos')
  async novo(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(novoSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into priv.documentos (empresa_id, tipo_id, descricao, numero, emissor, origem, sem_vencimento)
      values (${empresa}::uuid, ${d.tipoId}::uuid, ${d.descricao}, ${d.numero ?? null}, ${d.emissor ?? null}, ${d.origem ?? null}, ${d.semVencimento ?? false})
      returning id`.execute(tx)).rows[0]);
  }

  @Permissao('documentos', 'arquivar')
  @Post('empresas/:empresa/documentos/:id/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update priv.documentos set deleted_at = now() where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  @Permissao('documentos', 'visualizar')
  @Get('empresas/:empresa/documentos/:id/versoes')
  versoes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql`
      select id, versao, nome_original as nome, tipo_real as "tipoReal", tamanho::text as tamanho, emissao::text as emissao, validade::text as validade,
             status_arquivo as "statusArquivo", motivo_bloqueio as "motivoBloqueio", created_at as "criadaEm"
        from priv.documento_versoes where documento_id = ${id}::uuid and empresa_id = ${empresa}::uuid order by versao desc`.execute(tx)).rows);
  }

  // Passo 1 do upload: cria a versão em quarentena e devolve a URL assinada de envio (5 min).
  @Permissao('documentos', 'cadastrar')
  @Post('empresas/:empresa/documentos/:id/versoes')
  async iniciar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(versaoSchema, corpo);
    const v = await this.q(req, async (tx) => (await sql<{ versao_id: string; chave: string; versao: number }>`
      select * from priv.iniciar_versao(${empresa}::uuid, ${id}::uuid, ${d.nome}, ${d.tamanho}::bigint, ${d.emissao ?? null}::date, ${d.validade ?? null}::date)`.execute(tx)).rows[0]);
    if (!v) throw new NotFoundException();
    return { versaoId: v.versao_id, versao: v.versao, url: await this.s3.urlParaEnviar(v.chave, d.tamanho) };
  }

  // Passo 2: o navegador terminou o envio; o banco enfileira a verificação (antivírus, tipo real, hash).
  @Permissao('documentos', 'cadastrar')
  @Post('empresas/:empresa/versoes/:vid/concluir')
  @HttpCode(202)
  async concluir(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('vid', new ParseUUIDPipe()) vid: string) {
    await this.q(req, (tx) => sql`select priv.concluir_upload(${empresa}::uuid, ${vid}::uuid)`.execute(tx));
    return { status: 'em_verificacao' };
  }

  // Download: permissão e versão liberada conferidas no banco, que REGISTRA quem baixou; a URL vale 60 s.
  @Permissao('documentos', 'visualizar')
  @Post('empresas/:empresa/versoes/:vid/download')
  @HttpCode(200)
  async baixar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('vid', new ParseUUIDPipe()) vid: string) {
    const r = await this.q(req, async (tx) => {
      const chave = (await sql<{ k: string }>`select priv.registrar_download(${empresa}::uuid, ${vid}::uuid) as k`.execute(tx)).rows[0]?.k;
      const nome = (await sql<{ n: string }>`select nome_original as n from priv.documento_versoes where id = ${vid}::uuid`.execute(tx)).rows[0]?.n ?? 'documento';
      return { chave, nome };
    });
    if (!r.chave) throw new NotFoundException();
    return { url: await this.s3.urlParaBaixar(r.chave, r.nome), expiraEmSegundos: 60 };
  }
}
