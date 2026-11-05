import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'

// Peças de layout em Tailwind com os tokens do Untitled UI (sem CSS próprio).

/** Coluna central de uma página: `larga` para listas e tabelas. */
export function Pagina({ larga, children }: { larga?: boolean; children: ReactNode }) {
  return <div className={cx('mx-auto flex w-full animate-in flex-col gap-6 duration-300 fade-in', larga ? 'max-w-5xl' : 'max-w-2xl')}>{children}</div>
}

/** Cabeçalho de página (título, subtítulo e ações à direita), como o "page header" do Untitled UI. */
export function CabecalhoPagina({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-secondary pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:flex-1">
        <h1 className="text-display-xs font-semibold text-primary">{titulo}</h1>
        {subtitulo ? <p className="mt-1 text-md text-tertiary [overflow-wrap:anywhere]">{subtitulo}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-3 sm:max-w-[60%] sm:justify-end">{acoes}</div> : null}
    </div>
  )
}

/** Cartão (card) com borda e sombra leve. */
export function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6', className)}>{children}</section>
}

export function Pilha({ children, grande, className }: { children: ReactNode; grande?: boolean; className?: string }) {
  return <div className={cx('flex flex-col', grande ? 'gap-6' : 'gap-4', className)}>{children}</div>
}

export function Linha({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-center gap-3', className)}>{children}</div>
}

export function Legenda({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-sm text-tertiary [overflow-wrap:anywhere]', className)}>{children}</p>
}

/** Estado vazio simples (texto centrado). */
export function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-tertiary">{children}</p>
}
