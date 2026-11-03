import { useState } from 'react'
import { ErroApi } from '../../../api/cliente'

// Estado de um formulário que chama a API: enviando, erro e mensagem de sucesso.
export function useEnvio() {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  async function enviar(acao: () => Promise<string | void>) {
    setEnviando(true)
    setErro(null)
    setOk(null)
    try {
      const msg = await acao()
      if (msg) setOk(msg)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }
  return { enviando, erro, ok, enviar, setErro }
}
