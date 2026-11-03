import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { chamar, ErroApi } from '../api/cliente'
import { descartarTokenWeb, tokenWebCapturado } from '../auth/fragmento'
import { problemaNaNovaSenha } from '../auth/links'
import { Aviso, Botao, Campo, TelaAcesso } from '../ui'

// Aberta pelo link do e-mail (`/redefinir-senha#token=...`). O token já saiu da URL no carregamento
// (auth/fragmento.ts) e só existe em memória.
export default function RedefinirSenha() {
  const [token] = useState(tokenWebCapturado)
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const problema = problemaNaNovaSenha(senha, confirmacao)
    if (problema) return setErro(problema)
    setEnviando(true)
    setErro(null)
    try {
      await chamar('POST', '/auth/redefinir', { token, senha })
      descartarTokenWeb()
      setPronto(true)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <TelaAcesso titulo="Nova senha">
      {pronto ? (
        <Aviso tipo="info" texto="Senha redefinida. As sessões abertas foram encerradas; entre com a nova senha." />
      ) : !token ? (
        <Aviso texto="Link inválido ou incompleto. Peça um novo em “Esqueci minha senha”." />
      ) : (
        <form className="pilha" onSubmit={(e) => void enviar(e)} noValidate>
          <Campo rotulo="Nova senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
          <Campo rotulo="Repita a nova senha" type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="new-password" />
          <Aviso texto={erro} />
          <Botao type="submit" cheio carregando={enviando}>
            Salvar nova senha
          </Botao>
        </form>
      )}
      <Link to="/entrar" className="legenda" style={{ textAlign: 'center' }}>
        Ir para entrar
      </Link>
    </TelaAcesso>
  )
}
