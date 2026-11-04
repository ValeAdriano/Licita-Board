import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const permissoesSchema = z.array(z.string().regex(/^[a-z_]+:[a-z_]+$/)).max(250);
const papelSchema = z.enum(['ADMIN_EMPRESA', 'OPERADOR', 'JURIDICO', 'CLIENTE']);
const empresaNovaSchema = z.object({
  razaoSocial: z.string().trim().min(2).max(200),
  nomeFantasia: z.string().trim().max(200).optional(),
  cnpj: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{12}[0-9]{2}$/),
}).strict();
const perfilSchema = z.object({
  nome: z.string().trim().min(1).max(200).optional(),
  telefone: z.string().trim().max(30).nullable().optional(),
  oab: z.string().trim().max(30).nullable().optional(),
}).strict();
const vinculoSchema = z.object({ papel: papelSchema, ativo: z.boolean(), permissoes: permissoesSchema, stepUp: z.uuid() }).strict();
const conviteSchema = z.object({
  email: z.email().max(254),
  papel: papelSchema,
  permissoes: permissoesSchema,
  stepUp: z.uuid(),
}).strict();

// Acesso (spec fase-01 §5): toda rota com :empresa passa por @Permissao no guard (1ª camada) e cada
// consulta roda com o contexto da sessão, filtrada pela RLS (2ª camada). Escritas sensíveis vão pelas
// funções do banco, que conferem permissão, step-up e teto de concessão.
@Controller()
export class AcessoController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Get('me')
  async me(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => {
      const u = await sql`select id, email::text as email, nome, telefone, oab, superadmin, core.tem_mfa() as "temMfa"
                            from core.usuarios where id = core.usuario_atual()`.execute(tx);
      const v = await sql`
        select id, empresa_id as "empresaId", empresa, papel, ativo, permissoes from core.meus_vinculos()`.execute(tx);
      return { usuario: u.rows[0], vinculos: v.rows };
    });
  }

  @Patch('me')
  async editarPerfil(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(perfilSchema, corpo);
    await this.q(req, (tx) => sql`
      update core.usuarios
         set nome = coalesce(${d.nome ?? null}, nome),
             telefone = case when ${d.telefone !== undefined} then ${d.telefone ?? null} else telefone end,
             oab = case when ${d.oab !== undefined} then ${d.oab ?? null} else oab end
       where id = core.usuario_atual()`.execute(tx));
    return {};
  }

  // Catálogo de módulos (não é dado de empresa): alimenta as linhas da matriz de permissões.
  @Get('modulos')
  async modulos(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`select slug, nome from core.modulos order by ordem`.execute(tx)).rows);
  }

  @Get('empresas')
  async empresas(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, razao_social as "razaoSocial", nome_fantasia as "nomeFantasia", cnpj
        from core.empresas order by razao_social`.execute(tx)).rows);
  }

  // Só SUPERADMIN (a policy de insert confere; outros recebem 403).
  @Post('empresas')
  async criarEmpresa(@Req() req: RequisicaoVV, @Body() corpo: unknown) {
    const d = validar(empresaNovaSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into core.empresas (razao_social, nome_fantasia, cnpj)
      values (${d.razaoSocial}, ${d.nomeFantasia ?? null}, ${d.cnpj}) returning id`.execute(tx)).rows[0]);
  }

  @Permissao('usuarios', 'visualizar')
  @Get('empresas/:empresa/usuarios')
  async usuarios(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select v.id as "vinculoId", u.id as "usuarioId", u.nome, u.email::text as email, v.papel, v.ativo,
             coalesce(array_agg(p.modulo || ':' || p.acao order by p.modulo, p.acao)
                      filter (where p.id is not null), '{}') as permissoes
        from core.vinculos v
        join core.usuarios u on u.id = v.usuario_id
        left join core.permissoes p on p.vinculo_id = v.id
       where v.empresa_id = ${empresa}::uuid and v.deleted_at is null
       group by v.id, u.id order by u.nome`.execute(tx)).rows);
  }

  // Matriz: papel, situação e permissões numa transação com um step-up (core.salvar_vinculo).
  @Put('vinculos/:id')
  async salvarVinculo(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(vinculoSchema, corpo);
    await this.q(req, (tx) => sql`
      select core.salvar_vinculo(${id}::uuid, ${d.papel}, ${d.ativo}, ${d.permissoes}::text[], ${d.stepUp}::uuid)`.execute(tx));
    return {};
  }

  @Permissao('permissoes', 'visualizar')
  @Get('empresas/:empresa/convites')
  async convites(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, email, papel, permissoes, created_at as "criadoEm", expira_em as "expiraEm",
             aceito_em as "aceitoEm", revogado_em as "revogadoEm"
        from core.convites where empresa_id = ${empresa}::uuid order by created_at desc`.execute(tx)).rows);
  }

  @Permissao('permissoes', 'administrar_permissoes')
  @Post('empresas/:empresa/convites')
  async convidar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(conviteSchema, corpo);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      select core.convidar_usuario(${empresa}::uuid, ${d.email}, ${d.papel}, ${d.permissoes}::text[], ${d.stepUp}::uuid) as id`
      .execute(tx)).rows[0]);
  }

  @Delete('convites/:id')
  @HttpCode(204)
  async revogarConvite(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select core.revogar_convite(${id}::uuid)`.execute(tx));
  }

  @Get('me/convites')
  async meusConvites(@Req() req: RequisicaoVV) {
    return this.q(req, async (tx) => (await sql`
      select id, empresa, papel, permissoes, convidado_em, expira_em, cnpj, convidado_por
        from core.meus_convites()`.execute(tx)).rows);
  }

  @Post('me/convites/:id/aceitar')
  async aceitarConvite(@Req() req: RequisicaoVV, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.q(req, async (tx) => (await sql<{ vinculo: string }>`
      select core.aceitar_convite(${id}::uuid) as vinculo`.execute(tx)).rows[0]);
  }

  @Permissao('auditoria', 'visualizar')
  @Get('empresas/:empresa/auditoria')
  async auditoria(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, occurred_at as "em", actor_id as "autor", table_name as tabela, operation as operacao,
             record_id as registro, changed_fields as campos
        from audit.audit_log where empresa_id = ${empresa}::uuid
       order by occurred_at desc limit 200`.execute(tx)).rows);
  }
}
