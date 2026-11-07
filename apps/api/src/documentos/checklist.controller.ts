import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const exigenciaSchema = z.object({
  tipoId: z.uuid(), aplicavel: z.boolean().optional(), conferenciaManual: z.boolean().optional(),
  // Sem o campo: o banco sugere pela pasta do tipo (fiscal e trabalhista) e mantém o valor numa atualização.
  regularidadeFiscal: z.boolean().nullable().optional(), observacao: z.string().trim().max(500).nullable().optional(),
}).strict();

interface LinhaChecklist {
  id: string; tipoId: string; tipoSlug: string; tipoNome: string; pasta: string; aplicavel: boolean; conferenciaManual: boolean;
  regularidadeFiscal: boolean; observacao: string | null; atualizadaEm: Date | string; situacao: string | null; documentoId: string | null;
  validade: string | null; diasParaVencer: number | null; aviso: string | null; dataReferencia: string | null; dataSessao: string | null;
  sessaoConfirmada: boolean | null; meEpp: boolean | null; calculadoEm: Date | string | null;
}

// Checklist documental por edital (spec fase-03 RF-03.10, §12). A pessoa registra as exigências do edital no acompanhamento;
// a situação de cada uma (válido, vencido, vence antes da sessão, ausente, não aplicável, depende de conferência) é CALCULADA
// pelo worker (rules/checklist_documental.py) e só lida aqui. A API nunca calcula nem grava resultado.
@Controller()
export class ChecklistController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('documentos', 'visualizar')
  @Get('empresas/:empresa/acompanhamentos/:id/checklist')
  async checklist(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const linhas = await this.q(req, async (tx) => (await sql<LinhaChecklist>`
      select e.id, e.tipo_id as "tipoId", t.slug as "tipoSlug", t.nome as "tipoNome", t.pasta, e.aplicavel,
             e.conferencia_manual as "conferenciaManual", e.regularidade_fiscal as "regularidadeFiscal", e.observacao,
             e.updated_at as "atualizadaEm", r.situacao, r.documento_id as "documentoId", r.validade::text as validade,
             r.dias_para_vencer as "diasParaVencer", r.aviso, r.data_referencia::text as "dataReferencia",
             r.data_sessao::text as "dataSessao", r.sessao_confirmada as "sessaoConfirmada", r.me_epp as "meEpp", r.calculado_em as "calculadoEm"
        from priv.checklist_exigencias e
        join pub.tipos_documento t on t.id = e.tipo_id
        left join priv.checklist_resultados r on r.exigencia_id = e.id
       where e.empresa_id = ${empresa}::uuid and e.acompanhamento_id = ${id}::uuid and e.deleted_at is null
       order by t.ordem, t.nome`.execute(tx)).rows);
    // Cabeçalho = o cálculo mais recente; item sem resultado ou editado depois do cálculo está "recalculando".
    const ms = (v: Date | string | null) => (v ? new Date(v).getTime() : 0);
    const recente = linhas.filter((l) => l.calculadoEm).sort((a, b) => ms(b.calculadoEm) - ms(a.calculadoEm))[0];
    return {
      acompanhamentoId: id,
      dataSessao: recente?.dataSessao ?? null,
      sessaoConfirmada: recente?.sessaoConfirmada ?? null,
      meEpp: recente?.meEpp ?? null,
      dataReferencia: recente?.dataReferencia ?? null,
      calculadoEm: recente?.calculadoEm ?? null,
      itens: linhas.map(({ atualizadaEm, ...l }) => ({
        ...l,
        recalculando: !l.calculadoEm || ms(atualizadaEm) > ms(l.calculadoEm),
      })),
    };
  }

  @Permissao('documentos', 'editar')
  @Post('empresas/:empresa/acompanhamentos/:id/checklist/exigencias')
  @HttpCode(201)
  async salvar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() corpo: unknown) {
    const d = validar(exigenciaSchema, corpo);
    const r = await this.q(req, (tx) => sql<{ id: string }>`
      select priv.salvar_exigencia_checklist(${empresa}::uuid, ${id}::uuid, ${d.tipoId}::uuid, ${d.aplicavel ?? null}::boolean,
        ${d.conferenciaManual ?? null}::boolean, ${d.regularidadeFiscal ?? null}::boolean, ${d.observacao ?? null}) as id`.execute(tx));
    return { id: r.rows[0]?.id, status: 'recalculando' };
  }

  @Permissao('documentos', 'editar')
  @Delete('empresas/:empresa/checklist/exigencias/:id')
  @HttpCode(204)
  async remover(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.remover_exigencia_checklist(${empresa}::uuid, ${id}::uuid)`.execute(tx));
  }

  @Permissao('documentos', 'editar')
  @Post('empresas/:empresa/acompanhamentos/:id/checklist/recalcular')
  @HttpCode(202)
  async recalcular(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.q(req, (tx) => sql`select priv.recalcular_checklist(${empresa}::uuid, ${id}::uuid)`.execute(tx));
    return { status: 'recalculando' };
  }
}
