// Formatação só de exibição. Dinheiro chega da API como string decimal e NUNCA vira number (regra 14).
export function moeda(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const [inteiro = '0', frac = '00'] = valor.split('.')
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${milhar},${(frac + '00').slice(0, 2)}`
}

export function quando(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}

export const BENEFICIO: Record<string, string> = {
  exclusivo_me_epp: 'Exclusivo ME/EPP',
  cota_reservada: 'Cota reservada ME/EPP',
  ampla_concorrencia: 'Ampla concorrência',
  nao_informado: 'Benefício não informado',
}

export const FAIXA: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa relevância' }

export interface FonteEstado {
  slug: string
  nome: string
  status: string
  ativa: boolean
  ultimoSucessoEm: string | null
  ultimaPesquisaEm: string | null
}

const VINTE_E_SEIS_HORAS = 26 * 3600 * 1000

// Fonte em problema (indisponível, degradada, nunca buscou ou busca antiga). Ausência de oportunidades só vale
// com todas as fontes ativas saudáveis e recentes (Prompt 4.9).
export function problemas(fontes: FonteEstado[], agora = Date.now()): string[] {
  return fontes
    .filter((f) => f.ativa)
    .filter((f) => f.status !== 'ok' || !f.ultimoSucessoEm || agora - new Date(f.ultimoSucessoEm).getTime() > VINTE_E_SEIS_HORAS)
    .map((f) => f.nome)
}
