import { Checkbox } from '@/components/base/checkbox/checkbox'

export function Caixa({ rotulo, marcado, onChange, desabilitado }: { rotulo: string; marcado: boolean; onChange: (v: boolean) => void; desabilitado?: boolean }) {
  return <Checkbox label={rotulo} isSelected={marcado} onChange={onChange} isDisabled={desabilitado} size="md" />
}
