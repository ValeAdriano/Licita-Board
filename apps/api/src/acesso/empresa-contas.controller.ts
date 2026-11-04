import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { CifraCampo, mascarar } from '../cripto/cifra-campo.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';
import { cnpjValido, cpfValido, normalizarChavePix, normalizarCnpj, soDigitos } from './documentos.js';

const agencia = z.string().trim().regex(/^[0-9]{1,5}(-[0-9Xx])?$/).transform((v) => v.toUpperCase());
const conta = z.string().trim().regex(/^[0-9]{1,12}(-[0-9Xx])?$/).transform((v) => v.toUpperCase());
// Titular: CPF (11 dígitos) ou CNPJ (14, numérico ou alfanumérico), com o dígito verificador conferido.
const documento = z.string().trim().max(18).transform((v) => (cpfValido(v) ? soDigitos(v) : cnpjValido(v) ? normalizarCnpj(v) : '')).pipe(z.string().min(11));
const pixTipo = z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']);

const contaNovaSchema = z.object({
  banco: z.string().trim().regex(/^[0-9]{3}$/),
  tipoConta: z.enum(['corrente', 'poupanca', 'pagamento']),
  titularNome: z.string().trim().min(2).max(200),
  agencia,
  conta,
  titularDocumento: documento,
  pixTipo: pixTipo.optional(),
  pixChave: z.string().trim().max(120).optional(),
  principal: z.boolean().optional(),
  stepUp: z.uuid(),
}).strict();
const contaEdicaoSchema = z.object({
  banco: contaNovaSchema.shape.banco.optional(),
  tipoConta: contaNovaSchema.shape.tipoConta.optional(),
  titularNome: contaNovaSchema.shape.titularNome.optional(),
  agencia: agencia.optional(),
  conta: conta.optional(),
  titularDocumento: documento.optional(),
  // null remove o PIX; um tipo exige a chave.
  pixTipo: pixTipo.nullable().optional(),
  pixChave: z.string().trim().max(120).optional(),
  principal: z.boolean().optional(),
  stepUp: z.uuid(),
}).strict();
const stepUpSchema = z.object({ stepUp: z.uuid() }).strict();
const revelarSchema = z.object({ campo: z.enum(['agencia', 'conta', 'titular_documento', 'pix_chave']), stepUp: z.uuid() }).strict();

// Contexto autenticado de cada campo cifrado: coluna + empresa (um envelope copiado para outra coluna
// ou outra empresa não decifra). A coluna do banco é `<campo>_cifrada` (ou `_cifrado` no documento).
const contexto = (campo: string, empresa: string) => `core.empresa_contas.${campo}:${empresa}`;

// Dados bancários e PIX (spec fase-02 §3.1 e §4.2; ADR-017). A API cifra ANTES de gravar e só devolve
// máscara; escrever e revelar passam por funções do banco com step-up `dados_bancarios`, permissão
// empresas/editar e aviso aos administradores. Nada em claro no banco, no log nem na auditoria.
@Controller()
export class EmpresaContasController {
  constructor(
    private readonly contextoDb: ContextoService,
    private readonly cifra: CifraCampo,
  ) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contextoDb.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  // Parte comum de criar e editar: cifra o que veio e monta o jsonb de core.salvar_conta.
  private montar(empresaUrl: string, d: Omit<z.infer<typeof contaEdicaoSchema>, 'stepUp'>): Record<string, unknown> {
    const empresa = empresaUrl.toLowerCase(); // o UUID entra na cifra e no hash: sempre em minúsculas
    const dados: Record<string, unknown> = {};
    if (d.banco !== undefined) dados.banco = d.banco;
    if (d.tipoConta !== undefined) dados.tipoConta = d.tipoConta;
    if (d.titularNome !== undefined) dados.titularNome = d.titularNome;
    if (d.principal !== undefined) dados.principal = d.principal;
    if (d.agencia !== undefined) {
      dados.agencia = this.cifra.cifrar(d.agencia, contexto('agencia', empresa));
      dados.agenciaMascara = mascarar(d.agencia);
    }
    if (d.conta !== undefined) {
      dados.conta = this.cifra.cifrar(d.conta, contexto('conta', empresa));
      dados.contaMascara = mascarar(d.conta);
    }
    if (d.titularDocumento !== undefined) {
      dados.titularDocumento = this.cifra.cifrar(d.titularDocumento, contexto('titular_documento', empresa));
      dados.titularDocumentoMascara = mascarar(d.titularDocumento);
    }
    if (d.pixTipo === null) {
      dados.pixTipo = null; // remove o PIX (as demais chaves de PIX ficam de fora de propósito)
    } else if (d.pixTipo !== undefined) {
      const chave = normalizarChavePix(d.pixTipo, d.pixChave ?? '');
      if (chave === null) throw new PixInvalido();
      dados.pixTipo = d.pixTipo;
      dados.pixChave = this.cifra.cifrar(chave, contexto('pix_chave', empresa));
      dados.pixHash = this.cifra.marca(`${d.pixTipo}:${chave}`, `pix:${empresa}`);
      dados.pixMascara = mascarar(chave);
    } else if (d.pixChave !== undefined) {
      throw new PixInvalido();
    }
    return dados;
  }

  @Permissao('empresas', 'visualizar')
  @Get('empresas/:empresa/contas')
  async contas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    return this.q(req, async (tx) => (await sql`
      select id, banco, tipo_conta as "tipoConta", titular_nome as "titularNome", pix_tipo as "pixTipo",
             agencia_mascara as "agenciaMascara", conta_mascara as "contaMascara",
             titular_documento_mascara as "titularDocumentoMascara", pix_mascara as "pixMascara", principal
        from core.empresa_contas
       where empresa_id = ${empresa}::uuid and deleted_at is null order by principal desc, created_at`.execute(tx)).rows);
  }

  @Permissao('empresas', 'editar')
  @Post('empresas/:empresa/contas')
  async nova(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const { stepUp, ...d } = validar(contaNovaSchema, corpo);
    if ((d.pixTipo === undefined) !== (d.pixChave === undefined)) throw new PixInvalido();
    const dados = this.montar(empresa, d);
    return this.q(req, async (tx) => ({
      id: (await sql<{ id: string }>`select core.salvar_conta(${empresa}::uuid, null, ${JSON.stringify(dados)}::jsonb, ${stepUp}::uuid) as id`.execute(tx)).rows[0]?.id,
    }));
  }

  @Permissao('empresas', 'editar')
  @Patch('empresas/:empresa/contas/:id')
  async editar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { stepUp, ...d } = validar(contaEdicaoSchema, corpo);
    const dados = this.montar(empresa, d);
    await this.q(req, (tx) => sql`
      select core.salvar_conta(${empresa}::uuid, ${id}::uuid, ${JSON.stringify(dados)}::jsonb, ${stepUp}::uuid)`.execute(tx));
    return {};
  }

  @Permissao('empresas', 'editar')
  @Post('empresas/:empresa/contas/:id/remover')
  @HttpCode(204)
  async remover(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { stepUp } = validar(stepUpSchema, corpo);
    await this.q(req, (tx) => sql`select core.remover_conta(${empresa}::uuid, ${id}::uuid, ${stepUp}::uuid)`.execute(tx));
  }

  // Revelar o valor inteiro: o banco confere permissão e step-up, REGISTRA a revelação e só então
  // devolve o envelope; a API decifra e responde. Sem cache (a API manda no-store).
  @Permissao('empresas', 'editar')
  @Post('empresas/:empresa/contas/:id/revelar')
  @HttpCode(200)
  async revelar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const { campo, stepUp } = validar(revelarSchema, corpo);
    const envelope = await this.q(req, async (tx) => (await sql<{ e: unknown }>`
      select core.revelar_conta(${empresa}::uuid, ${id}::uuid, ${campo}::text, ${stepUp}::uuid) as e`.execute(tx)).rows[0]?.e);
    return { campo, valor: this.cifra.decifrar(envelope, contexto(campo, empresa.toLowerCase())) };
  }
}

// Chave PIX que não bate com o tipo (ou tipo sem chave): 400 com mensagem fixa.
class PixInvalido extends BadRequestException {
  constructor() {
    super('Chave PIX inválida para o tipo informado.');
  }
}
