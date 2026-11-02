import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

// Componentes base mínimos. Substituídos por shadcn/ui quando o design system entrar (Fase 01, shell).

export function Card({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h1 className="mb-4 text-xl font-semibold">{titulo}</h1>
      {children}
    </section>
  )
}

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' }

export function Botao({ variante = 'primario', className = '', ...props }: BotaoProps) {
  const estilos = {
    primario: 'bg-marca text-white hover:bg-marca-escura',
    secundario:
      'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
    perigo: 'bg-red-700 text-white hover:bg-red-800',
  }[variante]
  return (
    <button
      type="button"
      className={`min-h-11 w-full rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${estilos} ${className}`}
      {...props}
    />
  )
}

type CampoProps = InputHTMLAttributes<HTMLInputElement> & { rotulo: string; erro?: string }

export function Campo({ rotulo, erro, id, ...props }: CampoProps) {
  const campoId = id ?? props.name
  return (
    <div className="mb-4">
      <label htmlFor={campoId} className="mb-1 block text-sm font-medium">
        {rotulo}
      </label>
      <input
        id={campoId}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${campoId}-erro` : undefined}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-950"
        {...props}
      />
      {erro && (
        <p id={`${campoId}-erro`} className="mt-1 text-sm text-red-700 dark:text-red-400">
          {erro}
        </p>
      )}
    </div>
  )
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'sucesso'; children: ReactNode }) {
  const estilos = {
    info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
    erro: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
    sucesso:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  }[tipo]
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${estilos}`}>
      {children}
    </div>
  )
}

export function TelaCentral({ children }: { children: ReactNode }) {
  return <main className="flex min-h-[calc(100dvh-1.5rem)] items-center justify-center p-4">{children}</main>
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <TelaCentral>
      <p role="status" className="text-sm text-slate-500">
        {texto}
      </p>
    </TelaCentral>
  )
}
