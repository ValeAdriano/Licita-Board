import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Só a chave PÚBLICA (anon/publishable). A autorização real é o RLS no banco (ADR-003).
const url = import.meta.env.VITE_SUPABASE_URL
const chavePublica = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigurado = Boolean(url && chavePublica)

// Chave fixa no localStorage: permite apagar a sessão à força se o signOut falhar (rede fora).
export const CHAVE_SESSAO = 'vv-auth'

export const supabase: SupabaseClient = createClient(url ?? 'http://127.0.0.1:54321', chavePublica ?? 'nao-configurado', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: CHAVE_SESSAO,
  },
})

// O evento PASSWORD_RECOVERY sai durante a inicialização do cliente, antes de qualquer componente
// montar. Registrar aqui, no carregamento do módulo, garante que ele não se perde.
let recuperacao = false
supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') recuperacao = true
  if (evento === 'SIGNED_OUT') recuperacao = false
})

/** Esta aba chegou pelo link de recuperação de senha do e-mail. */
export function emRecuperacaoDeSenha(): boolean {
  return recuperacao
}
