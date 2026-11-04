import { cx } from '@/utils/cx'

// Marca do produto: monograma VV (aprovada no lugar do logotipo de exemplo do Untitled UI) e nome.
export function Marca({ className, semNome }: { className?: string; semNome?: boolean }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-solid text-sm font-semibold text-white shadow-xs" aria-hidden="true">
        VV
      </span>
      {semNome ? null : <span className="text-md font-semibold text-primary">VV Licitações</span>}
    </span>
  )
}
