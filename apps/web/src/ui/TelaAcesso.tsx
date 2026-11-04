import type { ReactNode } from 'react'

// Página de acesso (login, MFA, recuperação): cartão centrado, sem navegação (padrão de login do Untitled UI).
export function TelaAcesso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-secondary px-4 py-10">
      <div className="flex w-full max-w-sm animate-in flex-col gap-8 duration-300 fade-in slide-in-from-bottom-2">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-brand-solid text-lg font-semibold text-white shadow-xs">VV</div>
          <p className="mt-3 text-lg font-semibold text-primary">VV Licitações</p>
          <p className="text-sm text-tertiary">Gestão de licitações públicas</p>
        </div>
        <section className="flex flex-col gap-6 rounded-2xl bg-primary p-6 shadow-lg ring-1 ring-secondary sm:p-8" aria-labelledby="titulo-acesso">
          <h1 id="titulo-acesso" className="text-display-xs font-semibold text-primary">
            {titulo}
          </h1>
          {children}
        </section>
      </div>
    </main>
  )
}
