import { AlertCircle, AlertTriangle, CheckCircle } from '@untitledui/icons'
import { cx } from '@/utils/cx'

type Tipo = 'erro' | 'info' | 'atencao'

const ESTILO = {
  erro: { caixa: 'border-error_subtle bg-error-primary text-error-primary', Icone: AlertCircle, icone: 'text-fg-error-primary' },
  atencao: { caixa: 'border-warning_subtle bg-warning-primary text-warning-primary', Icone: AlertTriangle, icone: 'text-fg-warning-primary' },
  info: { caixa: 'border-success_subtle bg-success-primary text-success-primary', Icone: CheckCircle, icone: 'text-fg-success-primary' },
} as const

// Mensagem ao usuário (padrão de alerta do Untitled UI). Erro é anunciado na hora (role=alert); info e
// atenção, com educação (status).
export function Aviso({ texto, tipo = 'erro' }: { texto: string | null | undefined; tipo?: Tipo }) {
  if (!texto) return null
  const { caixa, Icone, icone } = ESTILO[tipo]
  return (
    <p className={cx('flex items-start gap-3 rounded-xl border p-3 text-sm font-medium', caixa)} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Icone className={cx('mt-0.5 size-5 shrink-0', icone)} aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{texto}</span>
    </p>
  )
}
