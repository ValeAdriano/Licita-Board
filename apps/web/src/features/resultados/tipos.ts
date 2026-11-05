export const RESULTADO: Record<string, string> = {
  arrematada: 'Arrematada', adjudicada: 'Adjudicada', homologada: 'Homologada', contratada: 'Contratada', perdida: 'Perdida', inabilitada: 'Inabilitada',
  desclassificada: 'Desclassificada', fracassada: 'Fracassada', deserta: 'Deserta', revogada: 'Revogada', anulada: 'Anulada', cancelada: 'Cancelada',
}
export const COR_RESULTADO: Record<string, 'sucesso' | 'aviso' | 'erro' | 'cinza' | 'marca'> = {
  arrematada: 'marca', adjudicada: 'sucesso', homologada: 'sucesso', contratada: 'sucesso', perdida: 'erro', inabilitada: 'erro', desclassificada: 'erro',
  fracassada: 'cinza', deserta: 'cinza', revogada: 'cinza', anulada: 'cinza', cancelada: 'cinza',
}
export const HABILITACAO: Record<string, string> = { a_confirmar: 'A confirmar', em_analise: 'Em análise', habilitada: 'Habilitada', inabilitada: 'Inabilitada' }
// Resultados que abrem o gatilho de intenção de recurso (o banco decide; aqui só o aviso na tela).
export const ABRE_RECURSO = new Set(['perdida', 'inabilitada', 'desclassificada'])
export interface ResultadoItem {
  id: string; resultado: string; valorInicial: string | null; valorFinal: string | null; classificacao: number | null; melhorLance: string | null; vencedoraCnpj: string | null
  vencedoraNome: string | null; vencedoraMarcaModelo: string | null; motivo: string | null; habilitacao: string; ocorridoEm: string; gatilhoRecursal: boolean
}
