import { useEffect, useState } from 'react'

// Peças pequenas dos cadastros: seleção e caixa vêm do design system (Untitled UI) em `src/ui`.
import type { Opcao } from '../../../ui'
export { Caixa, Selecao, type Opcao } from '../../../ui'

export const dataBr = (iso?: string | null): string => (iso ? iso.split('-').reverse().join('/') : '—')

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
export const opcoesUf: Opcao[] = UFS.map((u) => ({ valor: u, rotulo: u }))

// Valor sensível revelado: fica na tela por 20 segundos e some (nada em armazenamento).
export function useValorTemporario(segundos = 20) {
  const [valor, setValor] = useState<{ chave: string; texto: string } | null>(null)
  useEffect(() => {
    if (!valor) return
    const t = setTimeout(() => setValor(null), segundos * 1000)
    return () => clearTimeout(t)
  }, [valor, segundos])
  return { valor, mostrar: (chave: string, texto: string) => setValor({ chave, texto }), esconder: () => setValor(null) }
}

// Texto livre de formulário → nulo quando vazio.
export const ouNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim())
