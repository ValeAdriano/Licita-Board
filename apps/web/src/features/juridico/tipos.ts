export const TIPO_PECA: Record<string, string> = { esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', recurso: 'Recurso administrativo', contrarrazoes: 'Contrarrazões' }
export const STATUS_PECA: Record<string, [string, 'cinza' | 'aviso' | 'marca' | 'sucesso' | 'erro']> = {
  sugerida: ['Sugerida', 'cinza'], triagem: ['Triagem', 'cinza'], minuta: ['Minuta', 'aviso'], revisao: ['Em revisão jurídica', 'aviso'], aprovada: ['Aprovada (gerando documento)', 'marca'],
  final: ['Documento final', 'sucesso'], protocolada: ['Protocolada', 'sucesso'], respondida: ['Respondida', 'sucesso'], descartada: ['Descartada', 'cinza'],
}
export const RESULTADO_PECA: Record<string, string> = { deferido: 'Deferido', parcialmente_deferido: 'Parcialmente deferido', indeferido: 'Indeferido' }
export const TIPO_BASE: Record<string, string> = { lei: 'Lei', lei_complementar: 'Lei Complementar', decreto: 'Decreto', regulamento: 'Regulamento', acordao: 'Acórdão', sumula: 'Súmula', constituicao: 'Constituição' }
export interface PecaLinha {
  id: string; tipo: string; titulo: string; status: string; acompanhamentoId: string; eventoId: string | null; prazoLegal: string | null; prazoInterno: string | null; statusEvento: string | null
  bloqueada: boolean; validadaEm: string | null; protocoloNumero: string | null; protocoladoEm: string | null; resultado: string | null; orgao: string | null; numeroEdital: string | null
}
export interface Peca extends PecaLinha {
  recursoId: string | null; minuta: string | null; minutaOrigem: 'manual' | 'ia' | 'ia_revisada'; minutaModelo: string | null; clausulas: string | null; justificativaDescarte: string | null; validacao: { codigo: string; mensagem: string; bloqueia: boolean }[] | null; arquivoSha256: string | null
  temArquivo: boolean; temPdf: boolean; geradoEm: string | null; comprovante: string | null; resultadoObs: string | null; resultadoEm: string | null; aprovadoPor: string | null; aprovadoEm: string | null; elaboradoPor: string | null
}
