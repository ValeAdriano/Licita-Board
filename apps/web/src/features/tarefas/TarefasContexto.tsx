import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'

export interface Tarefa { id: string; modulo: string; nivel: 'urgente' | 'atencao' | 'info'; titulo: string; detalhe: string | null; quando: string | null; link: string }
interface Tarefas { itens: Tarefa[]; contagens: Record<string, number>; total: number }
interface Estado { dados: Tarefas | null; carregando: boolean; recarregar: () => void }

const Contexto = createContext<Estado>({ dados: null, carregando: false, recarregar: () => undefined })
export const useTarefas = (): Estado => useContext(Contexto)
const INTERVALO_MS = 60_000

// Pendências da empresa selecionada (central de trabalho do Início e selos do menu): uma consulta só, renovada a cada minuto e ao voltar para a aba.
export function TarefasProvider({ children }: { children: ReactNode }) {
  const { empresa, pode } = useAcesso()
  const ativo = empresa !== null && pode('relatorios', 'visualizar')
  const r = useGet<Tarefas>(ativo && empresa ? `/empresas/${empresa.empresaId}/tarefas` : null)
  const { recarregar } = r
  useEffect(() => {
    if (!ativo) return
    const t = setInterval(recarregar, INTERVALO_MS)
    const ao = () => { if (document.visibilityState === 'visible') recarregar() }
    document.addEventListener('visibilitychange', ao)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', ao) }
  }, [ativo, recarregar])
  const valor = useMemo<Estado>(() => ({ dados: r.dados ?? null, carregando: r.carregando, recarregar }), [r.dados, r.carregando, recarregar])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
