import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { emRecuperacaoDeSenha, supabase } from '../supabase'
import { decidirAcesso, type Destino, exigeMfa } from './acesso'
import { useLogoutPorInatividade } from './inatividade'
import { sairForcado } from './sair'

type Perfil = { nome: string | null; superadmin: boolean; papeis: string[] }

type Acesso = {
  session: Session | null
  carregando: boolean
  destino: Destino
  perfil: Perfil | null
  fatorVerificadoId: string | null
  /** O perfil/MFA não pôde ser lido (rede, erro do servidor): a guarda mostra erro em vez de seguir. */
  falhou: boolean
  /** Esta aba chegou pelo link de recuperação de senha. */
  emRecuperacao: boolean
  recarregar: () => Promise<void>
  sair: (motivo?: string) => Promise<void>
}

const AuthContext = createContext<Acesso | null>(null)

async function carregarEstado(session: Session) {
  const [aal, fatores, usuario, vinculos] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    supabase.schema('core').from('usuarios').select('nome, superadmin').eq('id', session.user.id).maybeSingle(),
    supabase.schema('core').from('vinculos').select('papel').eq('usuario_id', session.user.id).eq('ativo', true).is('deleted_at', null),
  ])
  for (const r of [aal, fatores, usuario, vinculos]) {
    if (r.error) throw r.error
  }
  const perfil: Perfil = {
    nome: usuario.data?.nome ?? null,
    superadmin: Boolean(usuario.data?.superadmin),
    papeis: (vinculos.data ?? []).map((v) => String(v.papel)),
  }
  const fatorVerificado = fatores.data?.totp.find((f) => f.status === 'verified') ?? null
  const nivelAtual = aal.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'
  return { perfil, fatorVerificadoId: fatorVerificado?.id ?? null, nivelAtual } as const
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessaoCarregada, setSessaoCarregada] = useState(false)
  const [emRecuperacao, setEmRecuperacao] = useState(emRecuperacaoDeSenha())
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessaoCarregada(true)
    })
    const { data } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      setSession(novaSessao)
      setSessaoCarregada(true)
      if (evento === 'PASSWORD_RECOVERY') {
        setEmRecuperacao(true)
        navigate('/redefinir-senha', { replace: true })
      }
      if (evento === 'SIGNED_OUT') queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [navigate, queryClient])

  // A cada novo JWT (MFA verificado, refresh) o estado é relido. A chave usa expires_at, não o
  // token: chaves de cache podem aparecer em ferramentas de depuração e coletores de erro.
  const estado = useQuery({
    queryKey: ['acesso', session?.user.id, session?.expires_at],
    queryFn: () => carregarEstado(session as Session),
    enabled: Boolean(session),
    staleTime: 60_000,
  })

  const sair = useCallback((motivo?: string) => sairForcado(motivo), [])
  const expirar = useCallback(() => void sairForcado('inatividade'), [])
  useLogoutPorInatividade(Boolean(session), expirar)

  const valor = useMemo<Acesso>(() => {
    const temSessao = Boolean(session)
    const carregando = !sessaoCarregada || (temSessao && estado.isPending)
    const dados = estado.data
    const destino = decidirAcesso({
      temSessao,
      nivelAtual: dados?.nivelAtual ?? null,
      temFatorVerificado: Boolean(dados?.fatorVerificadoId),
      // Se o perfil não carregou (erro), exige MFA: falha fechado.
      mfaObrigatorio: dados ? exigeMfa(dados.perfil) : true,
    })
    return {
      session,
      carregando,
      destino,
      perfil: dados?.perfil ?? null,
      fatorVerificadoId: dados?.fatorVerificadoId ?? null,
      falhou: temSessao && estado.isError,
      emRecuperacao,
      recarregar: async () => {
        await queryClient.invalidateQueries({ queryKey: ['acesso'] })
      },
      sair,
    }
  }, [session, sessaoCarregada, estado.isPending, estado.isError, estado.data, queryClient, emRecuperacao, sair])

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth(): Acesso {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
