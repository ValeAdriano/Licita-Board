import { Toggle } from '@/components/base/toggle/toggle'

export function Interruptor({ rotulo, marcado, aoMudar, desabilitado }: { rotulo: string; marcado: boolean; aoMudar: (v: boolean) => void; desabilitado?: boolean }) {
  return <Toggle label={rotulo} isSelected={marcado} onChange={aoMudar} isDisabled={desabilitado} size="md" />
}
