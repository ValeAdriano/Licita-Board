import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { chamar, definirCsrf, ErroApi, limparCredenciais, observarCliente } from '../api/cliente'

// Estado da sessão no front (spec fase-01). A verdade é a API: o front só reflete o que ela diz e some
// com a tela ao perder a sessão. O token fica no cookie HttpOnly (o JS nunca o vê). Inatividade de
// 30 min encerra também do lado do front.
export type EstadoMfa = 'verificar' | 'cadastrar' | 'nao_requerido'
export type Fase = 'carregando' | 'sem_conexao' | 'anonimo' | 'mfa' | 'ativa'
export type Elevacao = 'verificar' | 'confirmar' | 'recuperacao'
export type EscopoStepUp = 'alterar_permissoes' | 'exclusao_definitiva' | 'preco_abaixo_minimo' | 'proposta_final' | 'aprovar_peca'

export const INATIVIDADE_MS = 30 * 60 * 1000

export function expirou(ultimaAtividade: number, agora: number, limite = INATIVIDADE_MS): boolean {
  return agora - ultimaAtividade >= limite
}

interface RespostaLogin {
  mfa: EstadoMfa
  csrf?: string
}
interface RespostaSessao {
  usuarioId?: string
  aal: 'aal1' | 'aal2'
  mfa: EstadoMfa
  csrf?: string
}

export interface Sessao {
  fase: Fase
  mfa: EstadoMfa
  entrar(email: string, senha: string, captcha?: string): Promise<void>
  cadastrarTotp(senha: string): Promise<{ uri: string }>
  elevar(tipo: Elevacao, codigo: string): Promise<void>
  // Step-up (spec §6 regra 10): código novo do autenticador → credencial de uso único (5 min) para
  // uma operação crítica do escopo. A API rotaciona o cookie da sessão.
  stepUp(escopo: EscopoStepUp, codigo: string): Promise<string>
  trocarSenha(atual: string, nova: string): Promise<void>
  concluirMfa(): void
  // Lança ErroApi se o servidor não encerrou a sessão (a tela avisa e oferece tentar de novo).
  sair(): Promise<void>
  registrarAtividade(): void
  recarregar(): void
}

const Contexto = createContext<Sessao | null>(null)

export function useSessao(): Sessao {
  const s = useContext(Contexto)
  if (!s) throw new Error('useSessao fora do SessaoProvider')
  return s
}

type Inicio = { fase: 'anonimo' | 'sem_conexao' } | { fase: 'sessao'; mfa: EstadoMfa; usuarioId: string | null }

// A API diz em que fase está a sessão do cookie. Sem rede, nada é descartado (não é sessão perdida).
async function lerSessao(): Promise<Inicio> {
  try {
    const s = await chamar<RespostaSessao>('GET', '/auth/sessao')
    definirCsrf(s.csrf ?? null)
    return { fase: 'sessao', mfa: s.mfa, usuarioId: s.usuarioId ?? null }
  } catch (e) {
    return { fase: e instanceof ErroApi && e.status === 0 ? 'sem_conexao' : 'anonimo' }
  }
}

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>('carregando')
  const [mfa, setMfa] = useState<EstadoMfa>('nao_requerido')
  const ultima = useRef(0) // gravado ao entrar e a cada uso
  const relendo = useRef(false)
  const usuarioConhecido = useRef<string | null>(null)
  // Último código de autenticador enviado, de qualquer tela: repetir o mesmo código é replay no banco
  // e conta como erro de MFA (5 encerram a sessão). Só memória; já é um código gasto.
  const ultimoCodigo = useRef<string | null>(null)

  const esquecer = useCallback(() => {
    limparCredenciais()
    setFase('anonimo')
  }, [])

  const aplicar = useCallback((estado: EstadoMfa) => {
    setMfa(estado)
    setFase(estado === 'nao_requerido' ? 'ativa' : 'mfa')
    ultima.current = Date.now()
  }, [])

  const iniciar = useCallback(
    (r: Inicio) => {
      if (r.fase === 'sessao') {
        usuarioConhecido.current = r.usuarioId
        aplicar(r.mfa)
      } else if (r.fase === 'sem_conexao') setFase('sem_conexao')
      else esquecer()
    },
    [aplicar, esquecer],
  )

  // Relê a sessão do cookie, em fundo (não conta como uso). Cobre: 403 "MFA" (perfil passou a exigir
  // segundo fator), 403 "CSRF" e aba que voltou a ficar visível (outra aba pode ter saído ou entrado com
  // outra conta: o cookie é compartilhado, o estado da tela não). Várias chamadas em paralelo: uma
  // releitura basta. Sem rede, nada muda.
  const reler = useCallback(() => {
    if (relendo.current) return
    relendo.current = true
    chamar<RespostaSessao>('GET', '/auth/sessao', undefined, { fundo: true })
      .then((s) => {
        definirCsrf(s.csrf ?? null)
        // Outra conta no mesmo navegador: nada da anterior fica na tela.
        if (usuarioConhecido.current && s.usuarioId && s.usuarioId !== usuarioConhecido.current) {
          window.location.reload()
          return
        }
        if (s.mfa !== 'nao_requerido') aplicar(s.mfa)
      })
      .catch(() => {})
      .finally(() => {
        relendo.current = false
      })
  }, [aplicar])

  useEffect(() => {
    observarCliente({
      aoPerderSessao: esquecer,
      aoUsar: () => {
        ultima.current = Date.now()
      },
      aoRelerSessao: reler,
    })
    void lerSessao().then(iniciar)
  }, [iniciar, esquecer, reler])

  const sair = useCallback(async () => {
    try {
      await chamar('POST', '/auth/logout')
    } catch (e) {
      if (!(e instanceof ErroApi && e.status === 401)) throw e
    }
    esquecer()
  }, [esquecer])

  // Por inatividade a tela some de qualquer jeito; o servidor também expira em 30 min.
  const expirar = useCallback(async () => {
    await chamar('POST', '/auth/logout').catch(() => {})
    esquecer()
  }, [esquecer])

  // Atividade do usuário (mouse, toque, teclado) renova o relógio; confere a cada 30 s e na hora em
  // que a aba volta a ficar visível (timers ficam parados com a aba em segundo plano).
  useEffect(() => {
    if (fase !== 'ativa' && fase !== 'mfa') return
    const marcar = () => {
      ultima.current = Date.now()
    }
    const conferir = () => {
      if (expirou(ultima.current, Date.now())) void expirar()
    }
    const aoVisivel = () => {
      if (document.visibilityState !== 'visible') return
      conferir()
      reler()
    }
    // Voltou do cache de navegação (botão voltar depois de sair em outra aba): confere o servidor.
    const aoReexibir = (e: PageTransitionEvent) => {
      if (e.persisted) reler()
    }
    const eventos = ['pointerdown', 'keydown', 'scroll'] as const
    for (const e of eventos) window.addEventListener(e, marcar, { passive: true })
    document.addEventListener('visibilitychange', aoVisivel)
    window.addEventListener('pageshow', aoReexibir)
    const id = setInterval(conferir, 30000)
    return () => {
      for (const e of eventos) window.removeEventListener(e, marcar)
      document.removeEventListener('visibilitychange', aoVisivel)
      window.removeEventListener('pageshow', aoReexibir)
      clearInterval(id)
    }
  }, [fase, expirar, reler])

  const valor = useMemo<Sessao>(
    () => ({
      fase,
      mfa,
      async entrar(email, senha, captcha) {
        limparCredenciais()
        const r = await chamar<RespostaLogin>('POST', '/auth/login', { email, senha, plataforma: 'web', captcha })
        definirCsrf(r.csrf ?? null)
        aplicar(r.mfa)
      },
      cadastrarTotp: (senha) => chamar<{ uri: string }>('POST', '/auth/mfa/cadastrar', { senha }),
      async elevar(tipo, codigo) {
        if (tipo !== 'recuperacao') usarCodigo(ultimoCodigo, codigo)
        await chamar('POST', `/auth/mfa/${tipo}`, { codigo })
      },
      async stepUp(escopo, codigo) {
        usarCodigo(ultimoCodigo, codigo)
        const r = await chamar<{ stepUp: string }>('POST', '/auth/mfa/step-up', { codigo, escopo })
        return r.stepUp
      },
      async trocarSenha(atual, nova) {
        await chamar('POST', '/auth/senha', { atual, nova })
      },
      concluirMfa: () => aplicar('nao_requerido'),
      sair,
      registrarAtividade() {
        ultima.current = Date.now()
      },
      recarregar() {
        setFase('carregando')
        void lerSessao().then(iniciar)
      },
    }),
    [fase, mfa, aplicar, sair, iniciar],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

// Recusa localmente (sem rede) o código de autenticador que já foi enviado nesta página.
function usarCodigo(ultimo: { current: string | null }, codigo: string): void {
  const c = codigo.trim()
  if (c === ultimo.current) throw new ErroApi(400, 'Esse código já foi usado. Aguarde o próximo código do autenticador.')
  ultimo.current = c
}

export function precisaCaptcha(e: unknown): boolean {
  return e instanceof ErroApi && e.status === 400 && e.message === 'CAPTCHA'
}

// O servidor não encerrou a sessão: não finge que saiu (computador compartilhado).
export function mensagemSair(e: unknown): string {
  const motivo = e instanceof ErroApi ? e.message : 'Algo deu errado.'
  return `Não foi possível encerrar a sessão no servidor. ${motivo} Tente de novo.`
}
