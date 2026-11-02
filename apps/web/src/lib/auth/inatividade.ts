import { useEffect } from 'react'

// Logout por inatividade (Prompt 1.4: 30 min). Vale em todas as rotas com sessão (montado no
// AuthProvider) e também ao REABRIR o app: a última atividade fica no localStorage.
export const LIMITE_INATIVIDADE_MS = 30 * 60 * 1000
const CHAVE = 'vv:ultima-atividade'
const EVENTOS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

function ler(): number | null {
  try {
    const v = localStorage.getItem(CHAVE)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

/** Marca atividade agora. Chamar logo após o login, antes de entrar no app. */
export function marcarAtividade(agora = Date.now()) {
  try {
    localStorage.setItem(CHAVE, String(agora))
  } catch {
    // armazenamento bloqueado: o temporizador em memória continua valendo
  }
}

export function esquecerAtividade() {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    // nada a apagar
  }
}

export function inativoDemais(ultima: number | null, agora: number, limite = LIMITE_INATIVIDADE_MS): boolean {
  // Sem registro de atividade com sessão restaurada: falha fechado.
  if (ultima === null || Number.isNaN(ultima)) return true
  return agora - ultima >= limite
}

export function useLogoutPorInatividade(ativo: boolean, aoExpirar: () => void, limite = LIMITE_INATIVIDADE_MS) {
  useEffect(() => {
    if (!ativo) return
    // Primeiro compara com o que estava salvo (app reaberto horas depois); só então marca agora.
    if (inativoDemais(ler(), Date.now(), limite)) {
      aoExpirar()
      return
    }
    let ultimaLocal = Date.now()
    marcarAtividade(ultimaLocal)

    const marcar = () => {
      ultimaLocal = Date.now()
      marcarAtividade(ultimaLocal)
    }
    // Abas compartilham a última atividade pelo localStorage; a mais recente vence.
    const verificar = () => {
      const ultima = Math.max(ultimaLocal, ler() ?? 0)
      if (inativoDemais(ultima, Date.now(), limite)) aoExpirar()
    }

    EVENTOS.forEach((e) => window.addEventListener(e, marcar, { passive: true }))
    document.addEventListener('visibilitychange', verificar)
    const timer = window.setInterval(verificar, 30_000)
    return () => {
      EVENTOS.forEach((e) => window.removeEventListener(e, marcar))
      document.removeEventListener('visibilitychange', verificar)
      window.clearInterval(timer)
    }
  }, [ativo, aoExpirar, limite])
}
