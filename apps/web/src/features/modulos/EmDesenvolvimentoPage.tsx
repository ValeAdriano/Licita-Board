import { Construction } from 'lucide-react'

// Prompt Mestre: "Não substituir funcionalidades reais por telas ilustrativas; recurso incompleto
// fica marcado como EM DESENVOLVIMENTO". Esta tela não simula dado nenhum.
export function EmDesenvolvimentoPage({ modulo, fase }: { modulo: string; fase?: string }) {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">{modulo}</h1>
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <Construction aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">EM DESENVOLVIMENTO</p>
          <p className="text-sm">
            Este módulo ainda não está disponível{fase ? ` (previsto na ${fase} do plano)` : ''}.
          </p>
        </div>
      </div>
    </div>
  )
}
