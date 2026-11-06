import { Controller, Get, Param, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { type RequisicaoVV, dadosDe, sessaoDe } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

export type Nivel = 'urgente' | 'atencao' | 'info';
export interface Tarefa { id: string; modulo: string; nivel: Nivel; titulo: string; detalhe: string | null; quando: string | null; link: string }
const ORDEM: Record<Nivel, number> = { urgente: 0, atencao: 1, info: 2 };
const JURIDICOS = ['esclarecimento', 'impugnacao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes'];
const ROTULO: Record<string, string> = { esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', intencao_recurso: 'Intenção de recurso', razoes_recurso: 'Razões de recurso', contrarrazoes: 'Contrarrazões' };
const DIA = 86_400_000;

// "Precisa da sua atenção" (central de trabalho do Início): cada pendência com o link direto para o item, só dos módulos que a pessoa pode ver.
// É uma LISTAGEM dos registros (nada é decidido aqui): prazos jurídicos e disputas próximas, peças a aprovar, contratos, documentos e oportunidades.
// Nível = só ordem de exibição: urgente (vencido ou em até 2 dias), atenção (até 7 dias ou item parado), informação.
@Controller()
export class TarefasController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('relatorios', 'visualizar')
  @Get('empresas/:empresa/tarefas')
  async tarefas(@Req() req: RequisicaoVV, @Param('empresa') empresa: string) {
    const e = empresa;
    return this.q(req, async (tx) => {
      const pode = async (m: string, a = 'visualizar'): Promise<boolean> => (await sql<{ ok: boolean }>`select core.has_permission(${e}::uuid, ${m}, ${a}) as ok`.execute(tx)).rows[0]?.ok === true;
      const agora = Date.now();
      const porPrazo = (quando: Date | string | null, urgenteAte = 2 * DIA, atencaoAte = 7 * DIA): Nivel => {
        if (quando === null) return 'info';
        const falta = new Date(quando).getTime() - agora;
        return falta <= urgenteAte ? 'urgente' : falta <= atencaoAte ? 'atencao' : 'info';
      };
      const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());
      const out: Tarefa[] = [];

      if (await pode('agenda')) {
        for (const r of (await sql<{ id: string; acomp: string; tipo: string; limite: Date; orgao: string }>`
          select ev.id::text, ev.acompanhamento_id::text as acomp, ev.tipo, ev.data_limite_legal as limite, g.razao_social as orgao
            from priv.agenda_eventos ev join priv.acompanhamentos a on a.id = ev.acompanhamento_id join pub.editais ed on ed.id = a.edital_id join pub.orgaos g on g.id = ed.orgao_id
           where ev.empresa_id = ${e}::uuid and ev.tipo = any(${JURIDICOS}::text[]) and ev.status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado') and ev.data_limite_legal is not null
             and ev.data_limite_legal <= now() + interval '7 days' and a.deleted_at is null and a.status not in ('encerrado', 'desistiu') order by ev.data_limite_legal limit 15`.execute(tx)).rows) {
          out.push({ id: `prazo:${r.id}`, modulo: 'agenda', nivel: porPrazo(r.limite), titulo: `${ROTULO[r.tipo] ?? r.tipo} · ${r.orgao}`, detalhe: new Date(r.limite).getTime() < agora ? 'Prazo VENCIDO' : 'Prazo legal', quando: iso(r.limite), link: `/agenda/acompanhamentos/${r.acomp}` });
        }
        for (const r of (await sql<{ id: string; abertura: Date; orgao: string }>`
          select a.id::text, a.data_abertura as abertura, g.razao_social as orgao from priv.acompanhamentos a join pub.editais ed on ed.id = a.edital_id join pub.orgaos g on g.id = ed.orgao_id
           where a.empresa_id = ${e}::uuid and a.deleted_at is null and a.status not in ('encerrado', 'desistiu') and a.data_abertura between now() and now() + interval '3 days' order by a.data_abertura limit 8`.execute(tx)).rows) {
          out.push({ id: `disputa:${r.id}`, modulo: 'agenda', nivel: porPrazo(r.abertura, DIA, 3 * DIA), titulo: `Disputa · ${r.orgao}`, detalhe: 'Abertura da sessão', quando: iso(r.abertura), link: `/agenda/acompanhamentos/${r.id}` });
        }
        for (const r of (await sql<{ id: string; orgao: string }>`
          select a.id::text, g.razao_social as orgao from priv.acompanhamentos a join pub.editais ed on ed.id = a.edital_id join pub.orgaos g on g.id = ed.orgao_id
           where a.empresa_id = ${e}::uuid and a.deleted_at is null and a.status not in ('encerrado', 'desistiu') and (a.edital_versao_vista < ed.versao_atual or a.abertura_reconfirmar) order by a.updated_at desc limit 5`.execute(tx)).rows) {
          out.push({ id: `retificado:${r.id}`, modulo: 'agenda', nivel: 'atencao', titulo: `Edital retificado · ${r.orgao}`, detalhe: 'Confira as mudanças e a data de abertura', quando: null, link: `/agenda/acompanhamentos/${r.id}` });
        }
      }
      if (await pode('juridico', 'aprovar_peca')) {
        for (const r of (await sql<{ id: string; titulo: string }>`select id::text, titulo from priv.pecas where empresa_id = ${e}::uuid and status = 'revisao' order by created_at limit 8`.execute(tx)).rows) {
          out.push({ id: `aprovar:${r.id}`, modulo: 'juridico', nivel: 'atencao', titulo: `Aprovar peça: ${r.titulo}`, detalhe: 'Aguardando revisão e aprovação jurídica', quando: null, link: `/juridico/pecas/${r.id}` });
        }
      }
      if (await pode('juridico', 'elaborar_peca')) {
        for (const r of (await sql<{ id: string; titulo: string; status: string; limite: Date | null }>`
          select p.id::text, p.titulo, p.status, ev.data_limite_legal as limite from priv.pecas p left join priv.agenda_eventos ev on ev.id = p.evento_id
           where p.empresa_id = ${e}::uuid and p.status in ('triagem', 'minuta') order by ev.data_limite_legal nulls last, p.created_at limit 8`.execute(tx)).rows) {
          out.push({ id: `elaborar:${r.id}`, modulo: 'juridico', nivel: r.limite ? porPrazo(r.limite) : 'info', titulo: `Elaborar peça: ${r.titulo}`, detalhe: r.status === 'triagem' ? 'Em triagem' : 'Minuta em andamento', quando: iso(r.limite), link: `/juridico/pecas/${r.id}` });
        }
        const sug = (await sql<{ n: number }>`select count(*)::int as n from priv.sugestoes_pecas where empresa_id = ${e}::uuid and status = 'nova'`.execute(tx)).rows[0]?.n ?? 0;
        if (sug > 0) out.push({ id: 'sugestoes', modulo: 'juridico', nivel: 'atencao', titulo: `${String(sug)} sugestão(ões) de peça aguardando decisão`, detalhe: 'Esclarecimentos e impugnações sugeridos pela IA', quando: null, link: '/juridico?aba=sugestoes' });
      }
      if (await pode('contratos')) {
        const sem = (await sql<{ n: number }>`
          select count(*)::int as n from priv.resultados_item ri join priv.participacoes pa on pa.id = ri.participacao_id and pa.empresa_id = ri.empresa_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id
           where ri.empresa_id = ${e}::uuid and ri.resultado_final = 'contratada' and not exists (select 1 from priv.contratos c where c.acompanhamento_id = a.id and c.empresa_id = a.empresa_id and c.deleted_at is null)`.execute(tx)).rows[0]?.n ?? 0;
        if (sem > 0 && (await pode('contratos', 'cadastrar'))) out.push({ id: 'contratada', modulo: 'contratos', nivel: 'atencao', titulo: `${String(sem)} edital(is) contratado(s) sem contrato cadastrado`, detalhe: 'Cadastre com os dados do contrato assinado', quando: null, link: '/contratos' });
        for (const r of (await sql<{ id: string; contrato: string; numero: string; prazo: Date; orgao: string }>`
          select e2.id::text, c.id::text as contrato, e2.numero, e2.prazo_entrega::timestamptz as prazo, c.orgao from priv.empenhos e2 join priv.contratos c on c.id = e2.contrato_id
           where e2.empresa_id = ${e}::uuid and c.deleted_at is null and c.status = 'ativo' and e2.prazo_entrega is not null and e2.etapa not in ('recebimento_definitivo', 'concluido')
             and e2.prazo_entrega <= current_date + 5 order by e2.prazo_entrega limit 8`.execute(tx)).rows) {
          out.push({ id: `entrega:${r.id}`, modulo: 'contratos', nivel: new Date(r.prazo).getTime() < agora ? 'urgente' : 'atencao', titulo: `Entrega do empenho ${r.numero} · ${r.orgao}`, detalhe: new Date(r.prazo).getTime() < agora ? 'Entrega atrasada' : 'Entrega próxima', quando: iso(r.prazo), link: `/contratos/${r.contrato}` });
        }
        for (const r of (await sql<{ id: string; contrato: string; fim: Date; orgao: string; numero: string }>`
          select c.id::text, c.id::text as contrato, c.vigencia_fim::timestamptz as fim, c.orgao, c.numero from priv.contratos c
           where c.empresa_id = ${e}::uuid and c.deleted_at is null and c.status = 'ativo' and c.vigencia_fim <= current_date + 30 order by c.vigencia_fim limit 5`.execute(tx)).rows) {
          out.push({ id: `vigencia:${r.id}`, modulo: 'contratos', nivel: new Date(r.fim).getTime() < agora ? 'urgente' : 'atencao', titulo: `Vigência do contrato ${r.numero} · ${r.orgao}`, detalhe: new Date(r.fim).getTime() < agora ? 'Vigência vencida' : 'Vigência termina em breve', quando: iso(r.fim), link: `/contratos/${r.contrato}` });
        }
      }
      if (await pode('financeiro')) {
        for (const r of (await sql<{ id: string; contrato: string; nf: string; venc: Date; orgao: string }>`
          select f.id::text, f.contrato_id::text as contrato, f.numero_nf as nf, f.vencimento::timestamptz as venc, c.orgao from priv.faturas f join priv.contratos c on c.id = f.contrato_id
           where f.empresa_id = ${e}::uuid and c.deleted_at is null and c.status = 'ativo' and f.pago_em is null and f.vencimento < current_date order by f.vencimento limit 8`.execute(tx)).rows) {
          out.push({ id: `pagamento:${r.id}`, modulo: 'contratos', nivel: 'urgente', titulo: `Pagamento da NF ${r.nf} · ${r.orgao}`, detalhe: 'Pagamento vencido', quando: iso(r.venc), link: `/contratos/${r.contrato}` });
        }
      }
      if (await pode('documentos')) {
        const d = (await sql<{ vencidos: number; a_vencer: number }>`
          select count(*) filter (where s.status = 'vencido')::int as vencidos, count(*) filter (where s.status = 'a_vencer')::int as a_vencer
            from priv.documentos d join priv.documentos_status s on s.documento_id = d.id where d.empresa_id = ${e}::uuid and d.deleted_at is null`.execute(tx)).rows[0];
        if (d && d.vencidos > 0) out.push({ id: 'docs-vencidos', modulo: 'cadastros', nivel: 'urgente', titulo: `${String(d.vencidos)} documento(s) vencido(s)`, detalhe: 'Atualize antes da próxima disputa', quando: null, link: '/cadastros' });
        if (d && d.a_vencer > 0) out.push({ id: 'docs-a-vencer', modulo: 'cadastros', nivel: 'atencao', titulo: `${String(d.a_vencer)} documento(s) vencendo em breve`, detalhe: null, quando: null, link: '/cadastros' });
      }
      if (await pode('editais')) {
        const o = (await sql<{ total: number; altas: number }>`
          select count(*)::int as total, count(*) filter (where faixa = 'alta')::int as altas from priv.oportunidades where empresa_id = ${e}::uuid and triagem = 'nova' and not retirado`.execute(tx)).rows[0];
        if (o && o.altas > 0) out.push({ id: 'oport-altas', modulo: 'oportunidades', nivel: 'atencao', titulo: `${String(o.altas)} oportunidade(s) prioritária(s) para triar`, detalhe: 'Nota alta', quando: null, link: '/oportunidades' });
        if (o && o.total - o.altas > 0) out.push({ id: 'oport-outras', modulo: 'oportunidades', nivel: 'info', titulo: `${String(o.total - o.altas)} outra(s) oportunidade(s) nova(s)`, detalhe: null, quando: null, link: '/oportunidades' });
      }
      if (await pode('propostas')) {
        for (const r of (await sql<{ acomp: string; versao: number; status: string; orgao: string }>`
          select p.acompanhamento_id::text as acomp, p.versao, p.status, g.razao_social as orgao from priv.propostas p join priv.acompanhamentos a on a.id = p.acompanhamento_id join pub.editais ed on ed.id = a.edital_id join pub.orgaos g on g.id = ed.orgao_id
           where p.empresa_id = ${e}::uuid and p.deleted_at is null and p.status in ('rascunho', 'conferencia', 'aprovada') order by p.updated_at desc limit 5`.execute(tx)).rows) {
          out.push({ id: `proposta:${r.acomp}:${String(r.versao)}`, modulo: 'agenda', nivel: 'info', titulo: `Proposta v${String(r.versao)} · ${r.orgao}`, detalhe: r.status === 'rascunho' ? 'Rascunho' : r.status === 'conferencia' ? 'Aguardando conferência' : 'Aprovada: gerando documento', quando: null, link: `/agenda/acompanhamentos/${r.acomp}/proposta` });
        }
      }
      out.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel] || (a.quando ?? '9').localeCompare(b.quando ?? '9'));
      const contagens: Record<string, number> = {};
      for (const t of out) if (t.nivel !== 'info') contagens[t.modulo] = (contagens[t.modulo] ?? 0) + 1;
      return { itens: out.slice(0, 40), contagens, total: out.length };
    });
  }
}
