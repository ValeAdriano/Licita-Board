import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { CifraCampo } from '../cripto/cifra-campo.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const MODELOS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const;
// Formato das chaves da Anthropic (sk-ant-...). A validação não revela o valor em nenhuma mensagem de erro.
const chaveSchema = z.object({ chave: z.string().trim().regex(/^sk-ant-[A-Za-z0-9_-]{20,300}$/, 'A chave não tem o formato esperado (sk-ant-...).'), modelo: z.enum(MODELOS).optional() }).strict();
const modeloSchema = z.object({ modelo: z.enum(MODELOS) }).strict();

// Chave do provedor de IA POR EMPRESA, cadastrada pela interface. A chave é cifrada aqui (envelope AES-256-GCM, ADR-017, contexto =
// tabela|coluna|empresa) ANTES de ir ao banco; nenhuma resposta a devolve (só os 4 últimos caracteres) e o vv_api nem lê a coluna cifrada.
// A API NUNCA fala com o provedor: o teste da chave é um job do worker.
@Controller()
export class IaController {
  constructor(private readonly contexto: ContextoService, private readonly cifra: CifraCampo) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('configuracoes', 'visualizar')
  @Get('empresas/:empresa/ia')
  async estado(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    const r = await this.q(req, async (tx) => (await sql<{ ultimos4: string; modelo: string | null; teste_status: string | null; teste_erro: string | null; teste_em: Date | null; atualizada_em: Date }>`
      select ultimos4, modelo, teste_status, teste_erro, teste_em, atualizada_em from priv.empresa_ia where empresa_id = ${empresa}::uuid`.execute(tx)).rows[0]);
    return {
      configurada: !!r, provedor: 'anthropic', ultimos4: r?.ultimos4 ?? null, modelo: r?.modelo ?? null, testeStatus: r?.teste_status ?? null, testeErro: r?.teste_erro ?? null,
      testeEm: r?.teste_em ?? null, atualizadaEm: r?.atualizada_em ?? null, modelosDisponiveis: MODELOS, modeloPadrao: MODELOS[0],
    };
  }

  @Permissao('configuracoes', 'editar')
  @Put('empresas/:empresa/ia/chave')
  @HttpCode(204)
  async salvar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(chaveSchema, corpo);
    const envelope = this.cifra.cifrar(d.chave, `priv.empresa_ia.chave|${empresa.toLowerCase()}`);
    await this.q(req, (tx) => sql`select priv.salvar_chave_ia(${empresa}::uuid, ${JSON.stringify(envelope)}::jsonb, ${d.chave.slice(-4)}, ${d.modelo ?? null})`.execute(tx));
  }

  @Permissao('configuracoes', 'editar')
  @Post('empresas/:empresa/ia/modelo')
  @HttpCode(204)
  async modelo(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Body() corpo: unknown) {
    const d = validar(modeloSchema, corpo);
    await this.q(req, (tx) => sql`select priv.definir_modelo_ia(${empresa}::uuid, ${d.modelo})`.execute(tx));
  }

  @Permissao('configuracoes', 'editar')
  @Delete('empresas/:empresa/ia/chave')
  @HttpCode(204)
  async remover(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    await this.q(req, (tx) => sql`select priv.remover_chave_ia(${empresa}::uuid)`.execute(tx));
  }

  @Permissao('configuracoes', 'editar')
  @Post('empresas/:empresa/ia/testar')
  @HttpCode(202)
  async testar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    await this.q(req, (tx) => sql`select priv.pedir_teste_chave_ia(${empresa}::uuid)`.execute(tx));
    return { status: 'testando' };
  }
}
