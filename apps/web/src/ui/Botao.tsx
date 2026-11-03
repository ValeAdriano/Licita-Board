import type { ButtonHTMLAttributes } from 'react'

type Variante = 'primario' | 'secundario' | 'texto' | 'perigo'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  cheio?: boolean
  carregando?: boolean
}

// Botão em pílula (skill apple-ui-design). `carregando` desabilita e marca aria-busy; o texto fica.
export function Botao({ variante = 'primario', cheio, carregando, className, children, disabled, type = 'button', ...resto }: Props) {
  const classes = ['btn', variante !== 'primario' && `btn--${variante}`, cheio && 'btn--cheio', className].filter(Boolean).join(' ')
  return (
    <button {...resto} type={type} className={classes} disabled={disabled || carregando} aria-busy={carregando || undefined}>
      {carregando ? 'Aguarde…' : children}
    </button>
  )
}
