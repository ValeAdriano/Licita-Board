import type { ReactNode } from 'react'
import { Button } from '@/components/base/buttons/button'

type Variante = 'primario' | 'secundario' | 'texto' | 'perigo'

const COR = { primario: 'primary', secundario: 'secondary', texto: 'tertiary', perigo: 'primary-destructive' } as const

interface Props {
  variante?: Variante
  cheio?: boolean
  carregando?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  onClick?: () => void
  className?: string
  children?: ReactNode
  role?: string
  'aria-selected'?: boolean
  'aria-label'?: string
  autoFocus?: boolean
}

// Botão do Untitled UI (react-aria). `carregando` desabilita e mostra o indicador; o texto fica.
export function Botao({ variante = 'primario', cheio, carregando, disabled, onClick, className, children, ...resto }: Props) {
  return (
    <Button
      {...resto}
      size="md"
      color={COR[variante]}
      isLoading={carregando}
      showTextWhileLoading
      isDisabled={disabled}
      onPress={onClick}
      className={[cheio && 'w-full', className].filter(Boolean).join(' ')}
    >
      {children}
    </Button>
  )
}
