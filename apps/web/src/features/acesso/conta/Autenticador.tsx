import { useEffect, useState } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { segredoDaUri } from '../../../auth/links'
import { useSessao } from '../../../auth/sessao'
import { Aviso, Botao, Campo } from '../../../ui'
import { useAcesso, type Usuario } from '../contexto'
import { Secao } from './Secao'
import { useEnvio } from './useEnvio'

type Acao = 'codigos' | 'trocar'
type Passo =
  | { tipo: 'inicio' }
  | { tipo: 'verificar'; acao: Acao } // código de agora: a API exige MFA dos últimos 5 min
  | { tipo: 'senha' }
  | { tipo: 'novo'; segredo: string }
  | { tipo: 'reverificar'; segredo: string } // passou de 5 min: código do autenticador ATUAL
  | { tipo: 'codigos'; codigos: string[] }

const INICIO: Passo = { tipo: 'inicio' }
const DICA_CODIGO = 'Use um código novo (não o do login). Cada código errado conta; 5 encerram a sessão.'
const DICA_CODIGOS = 'Se os códigos não apareceram, gere de novo: os anteriores podem ter deixado de valer.'
const MFA_ANTIGO = (e: unknown) => e instanceof ErroApi && e.status === 403

// Autenticador e códigos de recuperação (spec fase-01 decisão 7). Quem não tem autenticador ativa
// direto pela senha; trocar e gerar códigos pedem um código do atual. A chave e os códigos somem ao
// sair da tela (a página desmonta) ou depois de 60 s com a aba em segundo plano (só os códigos).
export function Autenticador({ usuario }: { usuario: Usuario }) {
  const { elevar } = useSessao()
  const { recarregar } = useAcesso()
  const [passo, setPasso] = useState<Passo>(INICIO)
  const [codigo, setCodigo] = useState('')
  const [senha, setSenha] = useState('')
  const { enviando, erro, ok, enviar, setErro } = useEnvio()
  const temMfa = usuario.temMfa

  // Os códigos de recuperação (mostrados uma vez) somem se a aba ficar 60 s em segundo plano. O
  // cadastro pendente NÃO: no celular é preciso sair para copiar a chave no app autenticador e
  // voltar; ele vence sozinho no servidor (5 min / 15 min).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const aoMudar = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => setPasso((p) => (p.tipo === 'codigos' ? INICIO : p)), 60000)
      }
    }
    document.addEventListener('visibilitychange', aoMudar)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', aoMudar)
    }
  }, [])

  const gerarCodigos = async () => {
    try {
      const r = await chamar<{ codigos: string[] }>('POST', '/auth/mfa/codigos')
      setPasso({ tipo: 'codigos', codigos: r.codigos })
    } catch (e) {
      throw new ErroApi(e instanceof ErroApi ? e.status : 0, `${e instanceof Error ? e.message : ''} ${DICA_CODIGOS}`.trim())
    }
  }

  const verificar = (acao: Acao) =>
    enviar(async () => {
      await elevar('verificar', codigo.trim())
      setCodigo('')
      if (acao === 'codigos') await gerarCodigos()
      else setPasso({ tipo: 'senha' })
    })

  const cadastrar = () =>
    enviar(async () => {
      try {
        const r = await chamar<{ uri: string }>('POST', '/auth/mfa/cadastrar', { senha })
        setSenha('')
        setPasso({ tipo: 'novo', segredo: segredoDaUri(r.uri) })
      } catch (e) {
        if (temMfa && MFA_ANTIGO(e)) setPasso({ tipo: 'verificar', acao: 'trocar' })
        throw e
      }
    })

  const confirmar = (segredo: string) =>
    enviar(async () => {
      try {
        await elevar('confirmar', codigo.trim())
      } catch (e) {
        if (temMfa && MFA_ANTIGO(e)) {
          setCodigo('')
          setPasso({ tipo: 'reverificar', segredo })
          return
        }
        throw e
      }
      // Confirmado: sai do passo na hora (repetir "confirmar" sem pendente contaria como erro).
      setCodigo('')
      setPasso(INICIO)
      await recarregar().catch(() => {})
      if (!temMfa) return gerarCodigos() // primeiro autenticador: códigos logo em seguida
      return 'Autenticador trocado. O anterior deixou de valer.'
    })

  const reverificar = (segredo: string) =>
    enviar(async () => {
      await elevar('verificar', codigo.trim())
      setCodigo('')
      setPasso({ tipo: 'novo', segredo })
    })

  const cancelar = () => {
    setErro(null)
    setCodigo('')
    setSenha('')
    setPasso(INICIO)
  }

  const campoCodigo = (rotulo = 'Código de 6 dígitos') => (
    <Campo rotulo={rotulo} value={codigo} onChange={(v) => setCodigo(v)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
  )

  return (
    <Secao titulo="Verificação em duas etapas">
      {passo.tipo === 'inicio' ? (
        temMfa ? (
          <div className="flex flex-col gap-4">
            <p>Autenticador ativo.</p>
            <Botao onClick={() => setPasso({ tipo: 'verificar', acao: 'codigos' })}>Gerar novos códigos de recuperação</Botao>
            <Botao variante="secundario" onClick={() => setPasso({ tipo: 'verificar', acao: 'trocar' })}>
              Trocar autenticador
            </Botao>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p>Proteja sua conta com um app autenticador.</p>
            <Botao onClick={() => setPasso({ tipo: 'senha' })}>Ativar autenticador</Botao>
          </div>
        )
      ) : null}
      {passo.tipo === 'verificar' ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void verificar(passo.acao) }}>
          <p>Digite o código do autenticador atual. {DICA_CODIGO}</p>
          {campoCodigo()}
          <Botao type="submit" carregando={enviando}>
            Continuar
          </Botao>
        </form>
      ) : null}
      {passo.tipo === 'senha' ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void cadastrar() }}>
          <p>Confirme sua senha para cadastrar o novo autenticador. Conclua em até 5 minutos.</p>
          <Campo rotulo="Senha" type="password" value={senha} onChange={(v) => setSenha(v)} autoComplete="current-password" />
          <Botao type="submit" carregando={enviando}>
            Continuar
          </Botao>
        </form>
      ) : null}
      {passo.tipo === 'novo' ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void confirmar(passo.segredo) }}>
          <p>No app autenticador, adicione uma conta digitando esta chave e confirme com o código gerado:</p>
          <p className="font-mono tracking-wide" data-testid="segredo">{passo.segredo}</p>
          {campoCodigo('Código do novo autenticador')}
          <Botao type="submit" carregando={enviando}>
            Confirmar
          </Botao>
        </form>
      ) : null}
      {passo.tipo === 'reverificar' ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void reverificar(passo.segredo) }}>
          <p>Passaram mais de 5 minutos. Digite um código do autenticador ATUAL para continuar o cadastro.</p>
          {campoCodigo('Código do autenticador atual')}
          <Botao type="submit" carregando={enviando}>
            Continuar
          </Botao>
        </form>
      ) : null}
      {passo.tipo === 'codigos' ? (
        <div className="flex flex-col gap-4">
          <p>Guarde em lugar seguro antes de sair desta tela. Eles não serão mostrados de novo; se havia códigos anteriores, eles deixaram de valer.</p>
          <div className="grid gap-1.5 rounded-lg border border-secondary bg-secondary p-3" data-testid="codigos">
            {passo.codigos.map((c) => (
              <span key={c} className="font-mono tracking-wide">
                {c.match(/.{1,5}/g)?.join('-')}
              </span>
            ))}
          </div>
          <Botao onClick={() => setPasso(INICIO)}>Guardei os códigos</Botao>
        </div>
      ) : null}
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {passo.tipo !== 'inicio' && passo.tipo !== 'codigos' ? (
        <Botao variante="texto" onClick={cancelar}>
          Cancelar
        </Botao>
      ) : null}
    </Secao>
  )
}
