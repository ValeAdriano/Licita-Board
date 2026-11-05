export const ETAPAS: Record<string, string> = {
  pedido_recebido: 'Pedido recebido', pedido_fornecedor: 'Pedido ao fornecedor', aguardando_producao: 'Aguardando produção', produto_disponivel: 'Produto disponível', faturamento_autorizado: 'Faturamento autorizado',
  nota_emitida: 'Nota fiscal emitida', transporte: 'Transporte', entrega: 'Entrega', recebimento_provisorio: 'Recebimento provisório', recebimento_definitivo: 'Recebimento definitivo', concluido: 'Processo concluído',
}
export const TIPO_EVENTO_CONTRATO: Record<string, string> = { aditivo: 'Aditivo', apostilamento: 'Apostilamento', prorrogacao: 'Prorrogação', reajuste: 'Reajuste', reequilibrio: 'Reequilíbrio', ocorrencia: 'Ocorrência' }
export interface ContratoLinha { id: string; tipo: string; numero: string; orgao: string; objeto: string; status: string; vigenciaInicio: string; vigenciaFim: string; valorTotal: string; empenhado: string; veFinanceiro: boolean; faturado: string; recebido: string; hoje: string }
export interface Detalhe {
  contrato: { id: string; tipo: string; numero: string; orgao: string; objeto: string; status: string; vigenciaInicio: string; vigenciaFim: string; valorTotal: string; gestorOrgao: string | null; fiscalOrgao: string | null; garantiaValor: string | null; garantiaAte: string | null; veFinanceiro: boolean }
  itens: { id: string; numeroItem: number; descricao: string; unidade: string | null; quantidade: string; valorUnitario: string; empenhado: string; entregue: string; saldoAEmpenhar: string }[]
  empenhos: { id: string; tipo: string; numero: string; emitidoEm: string; prazoEntrega: string | null; etapa: string; responsavel: string | null; observacao: string | null; itens: { id: string; contratoItemId: string; numeroItem: number; quantidade: string; entregue: string }[]; etapas: { etapa: string; quando: string; observacao: string | null }[]; entregas: { id: string; empenhoItemId: string; quantidade: string; data: string; recebimento: string; observacao: string | null }[] }[]
  faturas: { id: string; numeroNf: string; emitidaEm: string; valor: string; retencoes: string; vencimento: string; pagoEm: string | null; valorRecebido: string | null; ocorrencia: string | null; diasAtraso: number; aReceber: string }[] | null
  eventos: { id: string; tipo: string; data: string; descricao: string; valorAntes: string | null; valorDepois: string | null; vigenciaAntes: string | null; vigenciaDepois: string | null }[]
  alertas: { tipo: string; nivel: 'vencido' | 'proximo'; mensagem: string; dias: number }[]
}
export const dia = (d: string | null): string => (d ? d.split('-').reverse().join('/') : '—')
