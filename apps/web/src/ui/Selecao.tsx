import { NativeSelect } from '@/components/base/select/select-native'

export interface Opcao {
  valor: string
  rotulo: string
}

// Seleção do Untitled UI (select nativo estilizado: bom no celular e acessível).
export function Selecao(props: { rotulo: string; value: string; onChange: (v: string) => void; opcoes: Opcao[]; vazio?: string; disabled?: boolean }) {
  const opcoes = props.vazio !== undefined ? [{ valor: '', rotulo: props.vazio }, ...props.opcoes] : props.opcoes
  return (
    <NativeSelect
      label={props.rotulo}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      options={opcoes.map((o) => ({ label: o.rotulo, value: o.valor }))}
    />
  )
}
