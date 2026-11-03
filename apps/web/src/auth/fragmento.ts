import { tokenDoFragmento } from './links'

// O link do e-mail traz o token no fragmento (`#token=...`): o fragmento não vai ao servidor nem no
// Referer. Roda uma vez, no carregamento (main.tsx), antes do roteador: tira o token da barra de
// endereço e do histórico e o guarda em memória para a tela de redefinição.
let guardado: string | null = null

if (typeof window !== 'undefined' && /(^#|&)token=/.test(window.location.hash)) {
  guardado = tokenDoFragmento(window.location.hash)
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
}

// Sem apagar ao ler: o StrictMode de dev chama o inicializador do estado duas vezes.
export function tokenWebCapturado(): string | null {
  return guardado
}

export function descartarTokenWeb(): void {
  guardado = null
}
