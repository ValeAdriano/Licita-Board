import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Diálogo modal acessível: foco vai para dentro, Tab não escapa, Esc fecha e o foco volta para quem abriu.
export function Modal({ aberto, titulo, aoFechar, children }: { aberto: boolean; titulo: string; aoFechar: () => void; children: ReactNode }) {
  const idTitulo = useId()
  const caixa = useRef<HTMLDivElement>(null)
  const aoFecharRef = useRef(aoFechar)
  useEffect(() => {
    aoFecharRef.current = aoFechar
  })

  useEffect(() => {
    if (!aberto) return
    const anterior = document.activeElement as HTMLElement | null
    caixa.current?.querySelector<HTMLElement>('input,button')?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return aoFecharRef.current()
      if (e.key !== 'Tab' || !caixa.current) return
      const itens = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)]
      const primeiro = itens[0]
      const ultimo = itens[itens.length - 1]
      if (!primeiro || !ultimo) return
      // Foco fora do diálogo (ex.: o botão focado ficou desabilitado durante o envio): volta para dentro.
      if (!caixa.current.contains(document.activeElement)) {
        e.preventDefault()
        primeiro.focus()
      } else if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('keydown', tecla)
      anterior?.focus()
    }
  }, [aberto])

  if (!aberto) return null
  return (
    <div className="modal__fundo">
      <div ref={caixa} className="modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
        <h2 id={idTitulo}>{titulo}</h2>
        {children}
      </div>
    </div>
  )
}
