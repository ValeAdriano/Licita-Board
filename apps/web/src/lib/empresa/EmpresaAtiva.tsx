import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../supabase'

export type Empresa = { id: string; razao_social: string; nome_fantasia: string | null }

type Contexto = {
  empresas: Empresa[]
  ativa: Empresa | null
  selecionar: (id: string) => void
  carregando: boolean
}

const EmpresaContext = createContext<Contexto | null>(null)

// Lembrar a escolha é só conveniência deste navegador; o acesso real é decidido pelo RLS.
function chave(usuarioId: string) {
  return `vv:empresa-ativa:${usuarioId}`
}

function lerEscolha(usuarioId: string): string | null {
  try {
    return localStorage.getItem(chave(usuarioId))
  } catch {
    return null
  }
}

export function nomeDaEmpresa(e: Empresa): string {
  return e.nome_fantasia || e.razao_social
}

/** Empresa escolhida, se ainda acessível; senão a primeira da lista. */
export function escolherAtiva(empresas: Empresa[], escolhida: string | null): Empresa | null {
  return empresas.find((e) => e.id === escolhida) ?? empresas[0] ?? null
}

export function EmpresaAtivaProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const usuarioId = session?.user.id ?? ''
  const [escolhida, setEscolhida] = useState<string | null>(() => (usuarioId ? lerEscolha(usuarioId) : null))

  const consulta = useQuery({
    queryKey: ['empresas-acessiveis', usuarioId],
    enabled: Boolean(usuarioId),
    queryFn: async () => {
      // O RLS devolve só as empresas em que o usuário tem empresas/visualizar (ou todas, se SUPERADMIN).
      const { data, error } = await supabase
        .schema('core')
        .from('empresas')
        .select('id, razao_social, nome_fantasia')
        .is('deleted_at', null)
        .order('razao_social')
      if (error) throw error
      return data as Empresa[]
    },
  })

  const selecionar = useCallback(
    (id: string) => {
      setEscolhida(id)
      try {
        localStorage.setItem(chave(usuarioId), id)
      } catch {
        // armazenamento bloqueado: a escolha vale só nesta aba
      }
    },
    [usuarioId],
  )

  const valor = useMemo<Contexto>(() => {
    const empresas = consulta.data ?? []
    return { empresas, ativa: escolherAtiva(empresas, escolhida), selecionar, carregando: consulta.isPending }
  }, [consulta.data, consulta.isPending, escolhida, selecionar])

  return <EmpresaContext.Provider value={valor}>{children}</EmpresaContext.Provider>
}

export function useEmpresaAtiva(): Contexto {
  const ctx = useContext(EmpresaContext)
  if (!ctx) throw new Error('useEmpresaAtiva fora do EmpresaAtivaProvider')
  return ctx
}
