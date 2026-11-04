import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
const apenasDigitos = (v: string) => v.replace(/\D/g, '');
const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const cnae = z.string().trim().transform(apenasDigitos).pipe(z.string().regex(/^[0-9]{7}$/));
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));

// Campos editáveis da ficha: camelCase da API → coluna. Só entra o que está aqui (o grant do banco
// também limita as colunas); `undefined` = não mexe, `null` = limpa.
const COLUNAS = {
  razaoSocial: 'razao_social', nomeFantasia: 'nome_fantasia', inscricaoEstadual: 'inscricao_estadual',
  inscricaoMunicipal: 'inscricao_municipal', cnaePrincipal: 'cnae_principal', logradouro: 'logradouro', numero: 'numero',
  complemento: 'complemento', bairro: 'bairro', municipio: 'municipio', municipioIbge: 'municipio_ibge', uf: 'uf', cep: 'cep',
  regimeTributario: 'regime_tributario', observacoes: 'observacoes',
} as const;

const fichaSchema = z.object({
  razaoSocial: z.string().trim().min(2).max(200).optional(),
  nomeFantasia: texto(200),
  inscricaoEstadual: texto(30),
  inscricaoMunicipal: texto(30),
  cnaePrincipal: cnae.nullable().optional(),
  logradouro: texto(200),
  numero: texto(20),
  complemento: texto(100),
  bairro: texto(100),
  municipio: texto(100),
  municipioIbge: z.string().trim().regex(/^[0-9]{7}$/).nullable().optional(),
  uf: z.enum(UFS).nullable().optional(),
  cep: z.string().trim().transform(apenasDigitos).pipe(z.string().regex(/^[0-9]{8}$/)).nullable().optional(),
  regimeTributario: z.enum(['MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']).nullable().optional(),
  observacoes: texto(4000),
}).strict();

const cnaesSchema = z.object({ cnaes: z.array(cnae).max(50) }).strict();
const telefone = z.string().trim().transform(apenasDigitos).pipe(z.string().regex(/^[0-9]{10,13}$/));
const contatoBase = {
  rotulo: z.string().trim().max(50).nullable().optional(),
  principal: z.boolean().optional(),
};
const contatoNovoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('email'), valor: z.email().max(254), ...contatoBase }).strict(),
  z.object({ tipo: z.literal('telefone'), valor: telefone, ...contatoBase }).strict(),
  z.object({ tipo: z.literal('whatsapp'), valor: telefone, ...contatoBase }).strict(),
]);
// Edição: o tipo não muda (apague e inclua de novo); o banco confere o formato do valor pelo tipo.
const contatoEdicaoSchema = z.object({
  valor: z.string().trim().min(3).max(254).optional(),
  rotulo: z.string().trim().max(50).nullable().optional(),
  principal: z.boolean().optional(),
}).strict();
const enquadramentoSchema = z.object({
  porte: z.enum(['MEI', 'ME', 'EPP', 'DEMAIS']),
  dataReferencia: dataIso,
  fonte: z.enum(['declaracao', 'certidao_junta', 'outra']),
  observacao: z.string().trim().max(500).nullable().optional(),
}).strict();

// Ficha completa da empresa (spec fase-02 §3.1; Prompt 2.1). Toda rota com :empresa passa pelo
// @Permissao do guard (1ª camada) e cada consulta roda com o contexto da sessão, filtrada pela RLS
// (2ª camada). Sem delete físico: remover é marcar deleted_at.
@Controller()
export class EmpresaFichaController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('empresas', 'visualizar')
  @Get('empresas/:empresa')
  async empresa(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    const e = await this.q(req, async (tx) => (await sql`
      select id, razao_social as "razaoSocial", nome_fantasia as "nomeFantasia", cnpj, ativo,
             inscricao_estadual as "inscricaoEstadual", inscricao_municipal as "inscricaoMunicipal",
             cnae_principal as "cnaePrincipal", logradouro, numero, complemento, bairro, municipio,
             municipio_ibge as "municipioIbge", uf, cep, regime_tributario as "regimeTributario", observacoes
        from core.empresas where id = ${empresa}::uuid`.execute(tx)).rows[0]);
    if (!e) throw new NotFoundException();
    return e;
  }

  @Permissao('empresas', 'editar')
  @Patch('empresas/:empresa')
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(fichaSchema, corpo);
    const campos = (Object.keys(COLUNAS) as (keyof typeof COLUNAS)[]).filter((k) => d[k] !== undefined);
    if (campos.length === 0) return {};
    const atribuicoes = campos.map((k) => sql`${sql.ref(COLUNAS[k])} = ${d[k] ?? null}`);
    await this.q(req, (tx) => sql`
      update core.empresas set ${sql.join(atribuicoes)} where id = ${empresa}::uuid`.execute(tx));
    return {};
  }

  // CNAEs secundários: o conjunto enviado substitui o atual (remove o que saiu, inclui o que entrou).
  @Permissao('empresas', 'visualizar')
  @Get('empresas/:empresa/cnaes')
  async cnaes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql<{ cnae: string }>`
      select cnae from core.empresa_cnaes
       where empresa_id = ${empresa}::uuid and deleted_at is null order by cnae`.execute(tx)).rows.map((r) => r.cnae));
  }

  @Permissao('empresas', 'editar')
  @Put('empresas/:empresa/cnaes')
  @HttpCode(204)
  async trocarCnaes(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const { cnaes } = validar(cnaesSchema, corpo);
    const novos = [...new Set(cnaes)];
    await this.q(req, async (tx) => {
      await sql`update core.empresa_cnaes set deleted_at = now()
                 where empresa_id = ${empresa}::uuid and deleted_at is null and cnae <> all(${novos}::text[])`.execute(tx);
      await sql`insert into core.empresa_cnaes (empresa_id, cnae)
                select ${empresa}::uuid, c from unnest(${novos}::text[]) c
                 where not exists (select 1 from core.empresa_cnaes x
                                    where x.empresa_id = ${empresa}::uuid and x.cnae = c and x.deleted_at is null)`.execute(tx);
    });
  }

  @Permissao('empresas', 'visualizar')
  @Get('empresas/:empresa/contatos')
  async contatos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, tipo, valor, rotulo, principal from core.empresa_contatos
       where empresa_id = ${empresa}::uuid and deleted_at is null order by tipo, principal desc, created_at`.execute(tx)).rows);
  }

  @Permissao('empresas', 'editar')
  @Post('empresas/:empresa/contatos')
  async novoContato(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(contatoNovoSchema, corpo);
    return this.q(req, async (tx) => {
      // Um só principal por tipo: o novo principal tira o posto do anterior, na mesma transação.
      if (d.principal) {
        await sql`update core.empresa_contatos set principal = false
                   where empresa_id = ${empresa}::uuid and tipo = ${d.tipo} and principal and deleted_at is null`.execute(tx);
      }
      return (await sql<{ id: string }>`
        insert into core.empresa_contatos (empresa_id, tipo, valor, rotulo, principal)
        values (${empresa}::uuid, ${d.tipo}, ${d.valor}, ${d.rotulo ?? null}, ${d.principal ?? false}) returning id`.execute(tx)).rows[0];
    });
  }

  @Permissao('empresas', 'editar')
  @Patch('empresas/:empresa/contatos/:id')
  async editarContato(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(contatoEdicaoSchema, corpo);
    const r = await this.q(req, async (tx) => {
      if (d.principal) {
        await sql`update core.empresa_contatos set principal = false
                   where empresa_id = ${empresa}::uuid and principal and deleted_at is null and id <> ${id}::uuid
                     and tipo = (select tipo from core.empresa_contatos where id = ${id}::uuid and empresa_id = ${empresa}::uuid)`.execute(tx);
      }
      return sql`
        update core.empresa_contatos
           set valor = coalesce(${d.valor ?? null}, valor),
               rotulo = case when ${d.rotulo !== undefined} then ${d.rotulo ?? null} else rotulo end,
               principal = coalesce(${d.principal ?? null}, principal)
         where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx);
    });
    if (!r.numAffectedRows) throw new NotFoundException();
    return {};
  }

  @Permissao('empresas', 'editar')
  @Delete('empresas/:empresa/contatos/:id')
  @HttpCode(204)
  async removerContato(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update core.empresa_contatos set deleted_at = now()
       where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  // Enquadramento por data de referência: histórico (só inclusão). O vigente numa data vem do banco.
  @Permissao('empresas', 'visualizar')
  @Get('empresas/:empresa/enquadramentos')
  async enquadramentos(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, porte, data_referencia::text as "dataReferencia", fonte, observacao
        from core.empresa_enquadramentos where empresa_id = ${empresa}::uuid order by data_referencia desc`.execute(tx)).rows);
  }

  @Permissao('empresas', 'editar')
  @Post('empresas/:empresa/enquadramentos')
  async novoEnquadramento(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(enquadramentoSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte, observacao)
      values (${empresa}::uuid, ${d.porte}, ${d.dataReferencia}::date, ${d.fonte}, ${d.observacao ?? null}) returning id`.execute(tx)).rows[0]);
  }

  @Permissao('empresas', 'visualizar')
  @Get('empresas/:empresa/enquadramento')
  async enquadramentoEm(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query('data') data: unknown) {
    const d = validar(dataIso, data);
    const v = await this.q(req, async (tx) => (await sql`
      select porte, data_referencia::text as "dataReferencia" from core.enquadramento_em(${empresa}::uuid, ${d}::date)`.execute(tx)).rows[0]);
    if (!v) throw new NotFoundException();
    return v;
  }
}
