import { TextArea } from '@/components/base/textarea/textarea'

// Texto de várias linhas do Untitled UI. `onChange` recebe o texto.
export function AreaTexto(props: { rotulo: string; value: string; onChange: (v: string) => void; rows?: number; maxLength?: number; disabled?: boolean; dica?: string }) {
  return <TextArea label={props.rotulo} hint={props.dica} value={props.value} onChange={props.onChange} rows={props.rows} maxLength={props.maxLength} isDisabled={props.disabled} hideRequiredIndicator />
}
