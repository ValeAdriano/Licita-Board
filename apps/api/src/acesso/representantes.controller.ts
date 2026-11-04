import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { CifraCampo, mascarar } from '../cripto/cifra-campo.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { cpfValido, soDigitos } from './documentos.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const cpf = z.string().trim().max(14).refine((v) => cpfValido(v)).transform(soDigitos);
const campos = {
  rg: texto(30), orgaoExpedidor: texto(30), nacionalidade: texto(50), estadoCivil: texto(30), profissao: texto(80), cargo: texto(80),
  email: z.email().max(254).nullable().optional(),
  telefone: z.string().trim().transform(soDigitos).pipe(z.string().regex(/^[0-9]{10,13}$/)).nullable().optional(),
  oabNumero: z.string().trim().regex(/^[0-9]{1,7}$/).nullable().optional(),
  oabUf: z.enum(UFS).nullable().optional(),
};
const novoSchema = z.object({
  tipo: z.enum(['SOCIO_ADMINISTRADOR', 'PROCURADOR', 'ADVOGADO']), nome: z.string().trim().min(2).max(200), cpf, ...campos,
}).strict();
const edicaoSchema = z.object({
  tipo: z.enum(['SOCIO_ADMINISTRADOR', 'PROCURADOR', 'ADVOGADO']).optional(), nome: z.string().trim().min(2).max(200).optional(),
  cpf: cpf.optional(), ativo: z.boolean().optional(), ...campos,
}).strict();
const revelarSchema = z.object({ stepUp: z.uuid() }).strict();

// Colunas editáveis (camelCase → coluna). O CPF é tratado à parte (cifra + máscara + marca).
const COLUNAS = {
  tipo: 'tipo', nome: 'nome', rg: 'rg', orgaoExpedidor: 'orgao_expedidor', nacionalidade: 'nacionalidade', estadoCivil: 'estado_civil',
  profissao: 'profissao', cargo: 'cargo', email: 'email', telefone: 'telefone', oabNumero: 'oab_numero', oabUf: 'oab_uf', ativo: 'ativo',
} as const;

// Representantes legais, procuradores e advogados (spec fase-02 §3.2). CPF cifrado na API (ADR-017):
// só máscara na leitura; revelar exige step-up `dados_pessoais` e fica registrado.
@Controller()
export class RepresentantesController {
  constructor(
    private readonly contextoDb: ContextoService,
    private readonly cifra: CifraCampo,
  ) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contextoDb.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  private cpfDados(empresaUrl: string, valor: string) {
    const empresa = empresaUrl.toLowerCase();
    return {
      cifrado: JSON.stringify(this.cifra.cifrar(valor, `core.representantes.cpf:${empresa}`)),
      mascara: mascarar(valor),
      hash: this.cifra.marca(valor, `cpf:${empresa}`),
    };
  }

  @Permissao('representantes', 'visualizar')
  @Get('empresas/:empresa/representantes')
  async lista(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, tipo, nome, cpf_mascara as "cpfMascara", rg, orgao_expedidor as "orgaoExpedidor", nacionalidade,
             estado_civil as "estadoCivil", profissao, cargo, email, telefone, oab_numero as "oabNumero", oab_uf as "oabUf", ativo
        from core.representantes where empresa_id = ${empresa}::uuid and deleted_at is null order by nome`.execute(tx)).rows);
  }

  @Permissao('representantes', 'cadastrar')
  @Post('empresas/:empresa/representantes')
  async novo(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(novoSchema, corpo);
    const c = this.cpfDados(empresa, d.cpf);
    return this.q(req, async (tx) => (await sql<{ id: string }>`
      insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, rg, orgao_expedidor, nacionalidade,
                                       estado_civil, profissao, cargo, email, telefone, oab_numero, oab_uf)
      values (${empresa}::uuid, ${d.tipo}, ${d.nome}, ${c.cifrado}::jsonb, ${c.mascara}, ${c.hash}, ${d.rg ?? null}, ${d.orgaoExpedidor ?? null},
              ${d.nacionalidade ?? null}, ${d.estadoCivil ?? null}, ${d.profissao ?? null}, ${d.cargo ?? null}, ${d.email ?? null},
              ${d.telefone ?? null}, ${d.oabNumero ?? null}, ${d.oabUf ?? null}) returning id`.execute(tx)).rows[0]);
  }

  @Permissao('representantes', 'editar')
  @Patch('empresas/:empresa/representantes/:id')
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(edicaoSchema, corpo);
    const atrib = (Object.keys(COLUNAS) as (keyof typeof COLUNAS)[]).filter((k) => d[k] !== undefined).map((k) => sql`${sql.ref(COLUNAS[k])} = ${d[k] ?? null}`);
    if (d.cpf !== undefined) {
      const c = this.cpfDados(empresa, d.cpf);
      atrib.push(sql`cpf_cifrado = ${c.cifrado}::jsonb`, sql`cpf_mascara = ${c.mascara}`, sql`cpf_hash = ${c.hash}`);
    }
    if (atrib.length === 0) throw new BadRequestException('Dados inválidos.');
    const r = await this.q(req, (tx) => sql`
      update core.representantes set ${sql.join(atrib)} where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
    return {};
  }

  @Permissao('representantes', 'arquivar')
  @Post('empresas/:empresa/representantes/:id/arquivar')
  @HttpCode(204)
  async arquivar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.q(req, (tx) => sql`
      update core.representantes set deleted_at = now() where id = ${id}::uuid and empresa_id = ${empresa}::uuid and deleted_at is null`.execute(tx));
    if (!r.numAffectedRows) throw new NotFoundException();
  }

  @Permissao('representantes', 'editar')
  @Post('empresas/:empresa/representantes/:id/revelar-cpf')
  @HttpCode(200)
  async revelarCpf(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { stepUp } = validar(revelarSchema, corpo);
    const envelope = await this.q(req, async (tx) => (await sql<{ e: unknown }>`
      select core.revelar_cpf_representante(${empresa}::uuid, ${id}::uuid, ${stepUp}::uuid) as e`.execute(tx)).rows[0]?.e);
    return { valor: this.cifra.decifrar(envelope, `core.representantes.cpf:${empresa.toLowerCase()}`) };
  }
}
