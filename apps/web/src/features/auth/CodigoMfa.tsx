import { type FormEvent, useState } from 'react'
import { Aviso, Botao, Campo } from '../../components/ui'

type Props = { aoEnviar: (codigo: string) => Promise<string | null>; rotuloBotao?: string }

// Campo de código TOTP de 6 dígitos. aoEnviar devolve a mensagem de erro, ou null em caso de sucesso.
export function CodigoMfa({ aoEnviar, rotuloBotao = 'Confirmar' }: Props) {
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(codigo)) {
      setErro('Digite os 6 números do aplicativo autenticador.')
      return
    }
    setEnviando(true)
    setErro(await aoEnviar(codigo))
    setEnviando(false)
  }

  return (
    <form onSubmit={enviar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo
        rotulo="Código do autenticador"
        name="codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
        autoFocus
      />
      <Botao type="submit" disabled={enviando}>
        {enviando ? 'Verificando…' : rotuloBotao}
      </Botao>
    </form>
  )
}
