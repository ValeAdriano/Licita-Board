import { useEffect, useRef } from 'react'
import { TURNSTILE_SITEKEY } from '../config'

// Turnstile (spec fase-01 decisão 4): só aparece depois que a API pediu CAPTCHA. O script da
// Cloudflare carrega sob demanda (a tag e `window.turnstile` ficam até recarregar a página: só o
// widget sai ao desmontar). Quem carregou o script recarrega a página depois do login, para ele não
// ficar na sessão aberta (T5.18, T5.22): ver `scriptTurnstileCarregado`.
interface Turnstile {
  render(el: HTMLElement, o: { sitekey: string; action: string; callback: (t: string) => void; 'expired-callback': () => void; 'error-callback': () => void }): string
  reset(id: string): void
  remove(id: string): void
}
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let carregado = false
export const scriptTurnstileCarregado = () => carregado

function carregar(): Promise<Turnstile> {
  const w = window as unknown as { turnstile?: Turnstile }
  if (w.turnstile) return Promise.resolve(w.turnstile)
  carregado = true
  return new Promise((ok, falha) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onload = () => (w.turnstile ? ok(w.turnstile) : falha(new Error('turnstile')))
    s.onerror = () => falha(new Error('turnstile'))
    document.head.appendChild(s)
  })
}

export function Captcha({ aoResolver, acao }: { aoResolver: (token: string) => void; acao: 'login' | 'recuperar' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!TURNSTILE_SITEKEY) return
    let vivo = true
    let widget: { t: Turnstile; id: string } | null = null
    carregar()
      .then((t) => {
        if (!vivo || !ref.current) return
        const id = t.render(ref.current, {
          sitekey: TURNSTILE_SITEKEY,
          action: acao,
          callback: aoResolver,
          'expired-callback': () => t.reset(id),
          'error-callback': () => t.reset(id),
        })
        widget = { t, id }
      })
      .catch(() => {})
    return () => {
      vivo = false
      if (widget) widget.t.remove(widget.id)
    }
  }, [aoResolver, acao])
  if (!TURNSTILE_SITEKEY) return <p className="aviso aviso--atencao" role="status">Verificação adicional indisponível no momento. Tente mais tarde.</p>
  return <div ref={ref} />
}
