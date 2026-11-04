import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { chamar, ErroApi } from '../api/cliente'
import { precisaCaptcha } from '../auth/sessao'
import { Aviso, Botao, Campo, Captcha, TelaAcesso } from '../ui'

// Resposta sempre igual, exista ou não a conta (RF-01.11): a tela não sabe e não diz.
export default function Recuperar() {
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const [captcha, setCaptcha] = useState<{ pedido: boolean; token?: string }>({ pedido: false })
  const [enviando, setEnviando] = useState(false)
  const aoResolver = useCallback((token: string) => setCaptcha({ pedido: true, token }), [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return setErro('Informe o e-mail.')
    setEnviando(true)
    setErro(null)
    try {
      await chamar('POST', '/auth/recuperar', { email: email.trim(), captcha: captcha.token })
      setEnviado(true)
    } catch (e) {
      const pediu = precisaCaptcha(e)
      setErro(pediu ? 'Confirme a verificação abaixo e tente de novo.' : e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
      setCaptcha({ pedido: captcha.pedido || pediu })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <TelaAcesso titulo="Recuperar senha">
      {enviado ? (
        <Aviso tipo="info" texto="Se o e-mail estiver cadastrado, enviaremos um link em instantes. Ele vale por 30 minutos." />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void enviar(e)} noValidate>
          <Campo rotulo="E-mail" type="email" value={email} onChange={(v) => setEmail(v)} autoComplete="email" inputMode="email" spellCheck={false} />
          {captcha.pedido && !captcha.token ? <Captcha aoResolver={aoResolver} acao="recuperar" /> : null}
          <Aviso texto={erro} />
          <Botao type="submit" cheio carregando={enviando}>
            Enviar link
          </Botao>
        </form>
      )}
      <Link to="/entrar" className="text-sm text-tertiary [overflow-wrap:anywhere] text-center">
        Voltar para entrar
      </Link>
    </TelaAcesso>
  )
}
