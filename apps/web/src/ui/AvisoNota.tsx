import { AlertTriangle, InfoCircle } from '@untitledui/icons'
import { cx } from '@/utils/cx'

// Aviso permanente de uma tela (regra do produto, ressalva jurídica): fica numa linha só e abre o texto inteiro ao clicar, para não empurrar o
// conteúdo de trabalho para baixo. O texto completo continua acessível (leitor de tela e teclado: é um <details>).
export function AvisoNota({ resumo, texto, tipo = 'atencao' }: { resumo: string; texto: string; tipo?: 'atencao' | 'info' }) {
  const Icone = tipo === 'atencao' ? AlertTriangle : InfoCircle
  return (
    <details className={cx('group rounded-xl border px-3 py-2 text-sm', tipo === 'atencao' ? 'border-warning_subtle bg-warning-primary text-warning-primary' : 'border-secondary bg-secondary text-secondary')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <Icone className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{resumo}</span>
        <span className="shrink-0 text-xs underline group-open:hidden">Ler tudo</span>
        <span className="hidden shrink-0 text-xs underline group-open:inline">Recolher</span>
      </summary>
      <p className="mt-2 [overflow-wrap:anywhere]">{texto}</p>
    </details>
  )
}
