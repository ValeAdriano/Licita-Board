import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../api/cliente'
import { segredoDaUri } from '../auth/links'
import { mensagemSair, useSessao, type Elevacao } from '../auth/sessao'
import { Aviso, Botao, Campo, TelaAcesso } from '../ui'

// Segundo fator (RF-01.10). Primeiro acesso de perfil interno: cadastra o autenticador (com a senha
// de novo), confirma o código e mostra os 10 códigos de recuperação uma única vez.
export default function Mfa() {
  const { mfa, cadastrarTotp, elevar, concluirMfa, sair } = useSessao()
  const [segredo, setSegredo] = useState<string | null>(null)
  const [senha, setSenha] = useState('')
  const [codigo, setCodigo] = useState('')
  const [usarRecuperacao, setUsarRecuperacao] = useState(false)
  const [codigos, setCodigos] = useState<string[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function tentar(acao: () => Promise<void>) {
    setEnviando(true)
    setErro(null)
    try {
      await acao()
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  const iniciarCadastro = (e: FormEvent) => {
    e.preventDefault()
    return tentar(async () => {
      const r = await cadastrarTotp(senha)
      setSenha('')
      setSegredo(segredoDaUri(r.uri))
    })
  }

  const confirmar = (e: FormEvent) => {
    e.preventDefault()
    return tentar(async () => {
      const tipo: Elevacao = mfa === 'cadastrar' ? 'confirmar' : usarRecuperacao ? 'recuperacao' : 'verificar'
      await elevar(tipo, codigo.trim())
      setCodigo('')
      if (tipo !== 'confirmar') return concluirMfa()
      const r = await chamar<{ codigos: string[] }>('POST', '/auth/mfa/codigos')
      setCodigos(r.codigos)
    })
  }

  const sairComAviso = () => void sair().catch((e: unknown) => setErro(mensagemSair(e)))

  if (codigos) {
    return (
      <TelaAcesso titulo="Códigos de recuperação">
        <p>Guarde em lugar seguro antes de continuar. Cada código vale uma vez, se você perder o autenticador. Eles não serão mostrados de novo.</p>
        <div className="codigos" data-testid="codigos">
          {codigos.map((c) => (
            <span key={c} className="mono">
              {c.match(/.{1,5}/g)?.join('-')}
            </span>
          ))}
        </div>
        <Botao cheio onClick={concluirMfa}>
          Guardei os códigos
        </Botao>
      </TelaAcesso>
    )
  }

  const cadastrando = mfa === 'cadastrar'
  return (
    <TelaAcesso titulo={cadastrando ? 'Cadastrar autenticador' : 'Verificação em duas etapas'}>
      {cadastrando && !segredo ? (
        <form className="pilha" onSubmit={(e) => void iniciarCadastro(e)} noValidate>
          <p>Seu perfil exige um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password...). Confirme sua senha para começar.</p>
          <Campo rotulo="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
          <Aviso texto={erro} />
          <Botao type="submit" cheio carregando={enviando}>
            Continuar
          </Botao>
        </form>
      ) : (
        <form className="pilha" onSubmit={(e) => void confirmar(e)} noValidate>
          {segredo ? (
            <>
              <p>No app autenticador, adicione uma conta digitando esta chave:</p>
              <p className="mono" data-testid="segredo">{segredo}</p>
            </>
          ) : null}
          <Campo
            rotulo={usarRecuperacao ? 'Código de recuperação' : 'Código de 6 dígitos'}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode={usarRecuperacao ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            maxLength={usarRecuperacao ? 32 : 6}
          />
          <Aviso texto={erro} />
          <Botao type="submit" cheio carregando={enviando}>
            Confirmar
          </Botao>
          {!cadastrando ? (
            <Botao variante="texto" onClick={() => setUsarRecuperacao(!usarRecuperacao)}>
              {usarRecuperacao ? 'Usar o autenticador' : 'Usar código de recuperação'}
            </Botao>
          ) : null}
        </form>
      )}
      <Botao variante="texto" onClick={sairComAviso}>
        Sair
      </Botao>
    </TelaAcesso>
  )
}
