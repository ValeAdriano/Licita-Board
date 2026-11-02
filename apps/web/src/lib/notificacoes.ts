import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type Notificacao = {
  id: string
  tipo: string
  titulo: string
  corpo: string | null
  link: string | null
  lida_em: string | null
  created_at: string
}

/** Segunda camada além do check do banco: só caminho interno do app vira link (T3.1). */
export function linkInterno(link: string | null): string | null {
  if (!link) return null
  return /^\/(?![\/\\])[A-Za-z0-9/_?=&.-]*$/.test(link) && !link.includes('//') && !link.includes('..') ? link : null
}

/** Quantidade de notificações não lidas do usuário (o RLS limita às próprias). */
export function useNaoLidas(usuarioId: string | undefined) {
  return useQuery({
    queryKey: ['notificacoes', 'nao-lidas', usuarioId],
    enabled: Boolean(usuarioId),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .schema('core')
        .from('notificacoes')
        .select('id', { count: 'exact', head: true })
        .is('lida_em', null)
      if (error) throw error
      return count ?? 0
    },
  })
}
