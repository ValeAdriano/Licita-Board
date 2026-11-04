import { useId, type ReactNode } from 'react'

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby={id}>
      <h2 id={id}>{titulo}</h2>
      {children}
    </section>
  )
}
