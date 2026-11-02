import { useQuery } from '@tanstack/react-query'
import type { Modulo, Papel } from '../../lib/permissoes/matriz'
import { supabase } from '../../lib/supabase'

export type VinculoLinha = {
  id: string
  papel: Papel
  ativo: boolean
  usuario_id: string
  usuarios: { nome: string | null; email: string | null } | null
}

export type ConviteLinha = { id: string; email: string; papel: Papel; created_at: string; expira_em: string }

const core = () => supabase.schema('core')

export function useModulos() {
  return useQuery({
    queryKey: ['modulos'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await core().from('modulos').select('slug, nome').order('ordem')
      if (error) throw error
      return data as Modulo[]
    },
  })
}

/** O banco é a autoridade: has_permission responde pelo usuário logado. */
export function usePodeNaEmpresa(empresaId: string | undefined, modulo: string, acao: string) {
  return useQuery({
    queryKey: ['pode', empresaId, modulo, acao],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await core().rpc('has_permission', { p_empresa: empresaId, p_modulo: modulo, p_acao: acao })
      if (error) throw error
      return Boolean(data)
    },
  })
}

export function useVinculos(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['vinculos', empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await core()
        .from('vinculos')
        .select('id, papel, ativo, usuario_id, usuarios(nome, email)')
        .eq('empresa_id', empresaId ?? '')
        .is('deleted_at', null)
        .order('created_at')
      if (error) throw error
      return data as unknown as VinculoLinha[]
    },
  })
}

export function useConvitesPendentes(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['convites', empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await core()
        .from('convites')
        .select('id, email, papel, created_at, expira_em')
        .eq('empresa_id', empresaId ?? '')
        .is('aceito_em', null)
        .is('revogado_em', null)
        .gt('expira_em', new Date().toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ConviteLinha[]
    },
  })
}

export async function permissoesDoVinculo(vinculoId: string): Promise<Set<string>> {
  const { data, error } = await core().from('permissoes').select('modulo, acao').eq('vinculo_id', vinculoId)
  if (error) throw error
  return new Set((data ?? []).map((p) => `${p.modulo}:${p.acao}`))
}
