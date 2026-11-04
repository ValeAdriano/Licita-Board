import { RadioGroup } from 'react-aria-components'
import { RadioButton } from '@/components/base/radio-buttons/radio-buttons'
import { PAPEIS, type Papel } from '../matriz'

export function SeletorPapel(props: { papel: Papel; aoMudar: (p: Papel) => void; desabilitado?: boolean }) {
  const { papel, aoMudar, desabilitado } = props
  return (
    <RadioGroup aria-label="Papel" value={papel} onChange={(v) => aoMudar(v as Papel)} isDisabled={desabilitado} className="flex flex-wrap gap-x-6 gap-y-3" orientation="horizontal">
      {PAPEIS.map((p) => (
        <RadioButton key={p.id} value={p.id} label={p.rotulo} aria-label={p.rotulo} size="md" />
      ))}
    </RadioGroup>
  )
}
