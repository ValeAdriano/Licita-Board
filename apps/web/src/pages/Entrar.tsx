import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ErroApi } from '../api/cliente'
import { precisaCaptcha, useSessao } from '../auth/sessao'
import { Aviso, Botao, Campo, Captcha, scriptTurnstileCarregado, TelaAcesso } from '../ui'

export default function Entrar() {
  const { entrar } = useSessao()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [captcha, setCaptcha] = useState<{ pedido: boolean; token?: string }>({ pedido: false })
  const [enviando, setEnviando] = useState(false)
  const aoResolver = useCallback((token: string) => setCaptcha({ pedido: true, token }), [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !senha) return setErro('Informe e-mail e senha.')
    setEnviando(true)
    setErro(null)
    try {
      await entrar(email.trim(), senha, captcha.token)
      // O script do Turnstile não fica na página da sessão aberta: recarga completa (vale também se ele
      // foi carregado antes, na tela de recuperação), e a sessão volta pelo cookie.
      if (captcha.pedido || scriptTurnstileCarregado()) window.location.replace('/')
    } catch (e) {
      if (precisaCaptcha(e)) {
        setCaptcha({ pedido: true })
        setErro('Confirme a verificação abaixo e tente de novo.')
      } else {
        setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
        if (captcha.pedido) setCaptcha({ pedido: true })
      }
      setSenha('')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <TelaAcesso titulo="Entrar">
      <form className="flex flex-col gap-4" onSubmit={(e) => void enviar(e)} noValidate>
        <Campo rotulo="E-mail" type="email" value={email} onChange={(v) => setEmail(v)} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} />
        <Campo rotulo="Senha" type="password" value={senha} onChange={(v) => setSenha(v)} autoComplete="current-password" />
        {captcha.pedido && !captcha.token ? <Captcha aoResolver={aoResolver} acao="login" /> : null}
        <Aviso texto={erro} />
        <Botao type="submit" cheio carregando={enviando}>
          Entrar
        </Botao>
      </form>
      <Link to="/recuperar" className="text-sm text-tertiary [overflow-wrap:anywhere] text-center">
        Esqueci minha senha
      </Link>
    </TelaAcesso>
  )
}
