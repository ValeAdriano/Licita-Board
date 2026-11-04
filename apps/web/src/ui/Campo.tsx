import type { HTMLInputTypeAttribute, ReactNode } from 'react'
import { Input } from '@/components/base/input/input'

interface Props {
  rotulo: string
  value?: string
  onChange?: (valor: string) => void
  type?: HTMLInputTypeAttribute
  maxLength?: number
  minLength?: number
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'search' | 'none'
  autoComplete?: string
  autoFocus?: boolean
  spellCheck?: boolean
  autoCapitalize?: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters'
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  name?: string
  id?: string
  min?: string | number
  max?: string | number
  dica?: ReactNode
  erro?: boolean
  className?: string
}

// Campo de texto do Untitled UI: rótulo, dica e estado de erro. `onChange` recebe o texto (não o evento).
export function Campo({ rotulo, disabled, readOnly, required, erro, dica, spellCheck, ...resto }: Props) {
  return (
    <Input
      {...resto}
      label={rotulo}
      hint={dica}
      isDisabled={disabled}
      isReadOnly={readOnly}
      isRequired={required}
      isInvalid={erro}
      spellCheck={spellCheck === undefined ? undefined : String(spellCheck)}
      hideRequiredIndicator
    />
  )
}
