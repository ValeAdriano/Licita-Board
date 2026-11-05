// Formatação só de exibição, SEM number: dinheiro chega como string decimal e assim fica (regra 14).
export function reais(valor: string | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const negativo = valor.startsWith('-')
  const [inteiro = '0', frac = ''] = valor.replace('-', '').split('.')
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const f = (frac + '0'.repeat(casas)).slice(0, casas)
  return `${negativo ? '-' : ''}R$ ${milhar}${casas > 0 ? `,${f}` : ''}`
}
// "10.0000" vira "10" e "10" continua "10" (só mexe quando há parte decimal).
export const semZeros = (v: string): string => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v)
export function pct(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const [i = '0', f = ''] = valor.split('.')
  const dec = f.replace(/0+$/, '')
  return `${i}${dec ? `,${dec}` : ''}%`
}
// Campo digitado em pt-BR ("1.234,50" ou "12,5") para a string decimal da API ("1234.50").
// Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto é o decimal ("1.5" vale 1,5, nunca 15).
export function paraDecimal(v: string): string {
  const t = v.trim()
  return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
}
export const ehDecimal = (v: string): boolean => /^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,4})?$|^\d+\.\d{1,4}$/.test(v.trim())
export const TIPO_LINHA: Record<string, string> = {
  aquisicao: 'Aquisição', frete: 'Frete', seguro: 'Seguro', instalacao: 'Instalação', acessorio: 'Acessórios', garantia_adicional: 'Garantia adicional',
  encargo_financeiro: 'Encargos financeiros', contingencia: 'Contingência', despesa_administrativa: 'Despesa administrativa', comissao: 'Comissão', tributo: 'Tributo', outro: 'Outro',
}
