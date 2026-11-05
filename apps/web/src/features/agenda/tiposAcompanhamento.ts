export interface ItemPart {
  itemId: string; numeroItem: number; descricao: string; quantidade: string | null; unidadeMedida: string | null; valorEstimado: string | null
  beneficio: string; retirado: boolean; participacaoId: string | null; status: string | null; prioridade: string | null; responsavelId: string | null
  situacaoDocumentacao: string | null; situacaoProposta: string | null; situacaoJuridica: string | null; atendimentoTecnico: string | null
  marca: string | null; modelo: string | null; versao: string | null; valorUnitario: string | null; valorTotal: string | null; pendencias: string | null; observacoes: string | null
}
export interface EventoDet {
  id: string; tipo: string; status: string; baseData: string | null; dataLimite: string | null; dataInterna: string | null; origemPrazo: string; clausula: string | null
  provisorio: boolean; regraValidada: boolean; aviso: string | null; justificativa: string | null; responsavelId: string | null; artigo: string | null
}
export interface Historico { id: string; eventoId: string; campo: string; antes: string | null; depois: string | null; motivo: string | null; em: string; quem: string | null }
export interface Detalhe {
  id: string; status: string; prioridade: string; dataAbertura: string | null; aberturaOrigem: string; aberturaConfirmada: boolean; aberturaClausula: string | null
  portal: string | null; linkDisputa: string | null; linkDocumentos: string | null; prazoEsclarecimentoEdital: string | null; prazoImpugnacaoEdital: string | null
  clausulaPrazos: string | null; confiabilidade: string; observacoes: string | null; ultimaConferenciaEm: string | null; responsavelId: string | null
  editalVersaoVista: number; editalId: string; numeroEdital: string | null; processo: string | null; modalidade: string | null; objeto: string; editalVersaoAtual: number
  linkOrigem: string | null; encerramentoPropostasPncp: string | null; situacaoEdital: string | null; orgao: string; uf: string | null; municipio: string | null; codigoIbge: string | null
  itens: ItemPart[]; eventos: EventoDet[]; historico: Historico[]
}
