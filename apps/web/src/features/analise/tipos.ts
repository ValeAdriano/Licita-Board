// Tipos e rótulos da análise técnica (Fase 06). Valores numéricos chegam e saem como string decimal (regra 14).
export interface Requisito {
  id: string; nome: string; tipo: string; atributoId: string | null; operador: string; valorNumero: string | null; valorMax: string | null
  valorTexto: string | null; unidadeId: string | null; obrigatorio: boolean; citacaoEdital: string | null; pagina: number | null; origem: string
  modeloIa?: string | null; confirmado?: boolean
}
export interface Extracao { status: 'pendente' | 'concluida' | 'falhou' | 'desligada'; modelo: string | null; requisitosCriados: number; descartados: number; semCitacao: number; erro: string | null; criadaEm: string }
export interface Linha {
  id: string; analiseId: string; requisitoId: string; resultado: Resultado; valorOferecido: string | null; citacaoVerificada: boolean; paginaEdital: number | null
  fichaTrecho: string | null; fichaPagina: number | null; fichaDocumentoId: string | null; fichaCitacaoVerificada?: boolean
  fichaConferidaEm: string | null; fichaConferidaPor: string | null; ressalva: string | null; justificativa: string | null; pendencia: string | null
}
export type RotuloAlternativa = 'melhor_compativel' | 'segunda_alternativa' | 'terceira_alternativa' | 'outra' | 'reprovado'
export interface Analise {
  id: string; produtoId: string; codigoInterno: string | null; marca: string | null; modelo: string | null; descricao: string | null
  disponibilidade?: 'imediata' | 'sob_encomenda' | 'indisponivel' | null; prazoEntregaDias?: number | null; garantiaMeses?: number | null
  fichaDocumentoId?: string | null; precoCusto?: string | null; precoReferencia?: string | null
  posicaoAlternativa?: number | null; rotuloAlternativa?: RotuloAlternativa | null; riscosCount?: number; pendenciasCount?: number
  resumo: Resumo | null; calculadoEm: string | null; aprovadoEm: string | null; aprovadoResumo: string | null; aprovadoPor: string | null; linhas: Linha[]
}
export interface Dados {
  participacao: { id: string; status: string; numeroItem: number | null; descricao: string | null; quantidade: string | null; unidadeMedida: string | null; acompanhamentoId: string; orgao: string | null; numeroEdital: string | null }
  requisitos: Requisito[]; analises: Analise[]; extracoes?: Extracao[]
  produtos: { id: string; codigoInterno: string; marca: string | null; modelo: string | null; descricao: string }[]
  atributos: { id: string; nome: string; tipo: string; grandeza: string | null; categoria: string }[]
  unidades: { id: string; simbolo: string; grandeza: string }[]
}
export type Resultado = 'ATENDE' | 'ATENDE COM RESSALVAS' | 'A CONFIRMAR' | 'NÃO ATENDE'
export type Resumo = 'COMPATÍVEL' | 'COMPATÍVEL COM RESSALVAS' | 'PENDENTE' | 'REPROVADO'

export const COR_RESULTADO: Record<Resultado, 'sucesso' | 'aviso' | 'erro' | 'cinza'> = { ATENDE: 'sucesso', 'ATENDE COM RESSALVAS': 'aviso', 'A CONFIRMAR': 'cinza', 'NÃO ATENDE': 'erro' }
export const COR_RESUMO: Record<Resumo, 'sucesso' | 'aviso' | 'erro' | 'cinza'> = { COMPATÍVEL: 'sucesso', 'COMPATÍVEL COM RESSALVAS': 'aviso', PENDENTE: 'cinza', REPROVADO: 'erro' }
export const ROTULO_ALTERNATIVA: Record<RotuloAlternativa, { texto: string; cor: 'sucesso' | 'marca' | 'aviso' | 'cinza' | 'erro' }> = {
  melhor_compativel: { texto: '1ª opção · Melhor compatível', cor: 'sucesso' },
  segunda_alternativa: { texto: '2ª alternativa', cor: 'marca' },
  terceira_alternativa: { texto: '3ª alternativa', cor: 'aviso' },
  outra: { texto: 'Alternativa adicional', cor: 'cinza' },
  reprovado: { texto: 'Reprovado', cor: 'erro' },
}
export const DISPONIBILIDADE_ROTULO: Record<string, string> = {
  imediata: 'Disponibilidade imediata',
  sob_encomenda: 'Sob encomenda',
  indisponivel: 'Indisponível',
}
export const OPERADOR: Record<string, string> = { '>=': 'no mínimo', '<=': 'no máximo', '=': 'igual a', entre: 'entre', contem: 'contém', sim: 'tem (sim)', nao: 'não tem' }
export const TIPO_EXIGENCIA: Record<string, string> = {
  obrigatorio: 'Obrigatório', minimo: 'Mínimo', maximo: 'Máximo', faixa: 'Faixa', opcional: 'Opcional', fabrica: 'Exigência de fábrica', certificacao: 'Certificação ou registro',
  garantia: 'Garantia', instalacao: 'Instalação', assistencia: 'Assistência', prazo_entrega: 'Prazo de entrega', outro: 'Outro',
}
export const exigido = (r: Requisito, unidades: Dados['unidades']): string => {
  const u = unidades.find((x) => x.id === r.unidadeId)?.simbolo ?? ''
  const n = (v: string | null) => (v === null ? '' : `${v.replace(/\.?0+$/, '')}${u ? ` ${u}` : ''}`)
  if (r.operador === 'entre') return `entre ${n(r.valorNumero)} e ${n(r.valorMax)}`
  if (r.operador === 'sim' || r.operador === 'nao') return OPERADOR[r.operador] ?? r.operador
  return `${OPERADOR[r.operador] ?? r.operador} ${r.valorNumero !== null ? n(r.valorNumero) : r.valorTexto ?? ''}`.trim()
}
