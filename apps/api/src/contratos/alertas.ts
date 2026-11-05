// Alertas do pós-licitação (11.5), calculados na hora a partir dos registros (datas YYYY-MM-DD no fuso de Brasília). Código puro.
export interface Alerta { tipo: 'vigencia' | 'garantia' | 'entrega' | 'pagamento'; nivel: 'vencido' | 'proximo'; mensagem: string; dias: number }
export interface Base {
  hoje: string; vigenciaFim: string; garantiaAte: string | null; status: string
  empenhos: { numero: string; prazoEntrega: string | null; etapa: string }[]
  faturas: { numeroNf: string; vencimento: string; pagoEm: string | null }[] | null
}
const JANELA_VIGENCIA = 60;
const JANELA_GARANTIA = 60;
const JANELA_ENTREGA = 5;
export const dias = (de: string, ate: string): number => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

export function alertas(b: Base): Alerta[] {
  const out: Alerta[] = [];
  if (b.status !== 'ativo') return out;
  const v = dias(b.hoje, b.vigenciaFim);
  if (v < 0) out.push({ tipo: 'vigencia', nivel: 'vencido', mensagem: `Vigência vencida há ${String(-v)} dia(s): prorrogar ou encerrar.`, dias: v });
  else if (v <= JANELA_VIGENCIA) out.push({ tipo: 'vigencia', nivel: 'proximo', mensagem: `Vigência termina em ${String(v)} dia(s): avalie a prorrogação.`, dias: v });
  if (b.garantiaAte) {
    const g = dias(b.hoje, b.garantiaAte);
    if (g < 0) out.push({ tipo: 'garantia', nivel: 'vencido', mensagem: `Garantia contratual vencida há ${String(-g)} dia(s).`, dias: g });
    else if (g <= JANELA_GARANTIA) out.push({ tipo: 'garantia', nivel: 'proximo', mensagem: `Garantia contratual vence em ${String(g)} dia(s).`, dias: g });
  }
  for (const e of b.empenhos) {
    if (!e.prazoEntrega || ['recebimento_definitivo', 'concluido'].includes(e.etapa)) continue;
    const d = dias(b.hoje, e.prazoEntrega);
    if (d < 0) out.push({ tipo: 'entrega', nivel: 'vencido', mensagem: `Entrega do empenho ${e.numero} atrasada há ${String(-d)} dia(s).`, dias: d });
    else if (d <= JANELA_ENTREGA) out.push({ tipo: 'entrega', nivel: 'proximo', mensagem: `Entrega do empenho ${e.numero} em ${String(d)} dia(s).`, dias: d });
  }
  for (const f of b.faturas ?? []) {
    if (f.pagoEm) continue;
    const d = dias(b.hoje, f.vencimento);
    if (d < 0) out.push({ tipo: 'pagamento', nivel: 'vencido', mensagem: `Pagamento da NF ${f.numeroNf} vencido há ${String(-d)} dia(s).`, dias: d });
  }
  return out;
}
