import { CHAVE_SESSAO, supabase } from '../supabase'
import { esquecerAtividade } from './inatividade'

function apagarSessaoLocal() {
  try {
    for (const chave of Object.keys(localStorage)) {
      if (chave === CHAVE_SESSAO || chave.startsWith(`${CHAVE_SESSAO}-`)) localStorage.removeItem(chave)
    }
  } catch {
    // armazenamento bloqueado: não há sessão persistida para apagar
  }
}

/**
 * Logout que nunca falha aberto (T5.2). Se o signOut der erro (rede fora, JWT expirado sem refresh),
 * a sessão local é apagada à força e a página é recarregada no login.
 */
export async function sairForcado(motivo?: string, redirecionar: (url: string) => void = (u) => window.location.replace(u)) {
  esquecerAtividade()
  const { error } = await supabase.auth.signOut({ scope: 'local' }).catch((e: unknown) => ({ error: e }))
  if (error) apagarSessaoLocal()
  redirecionar(motivo ? `/login?motivo=${encodeURIComponent(motivo)}` : '/login')
}
