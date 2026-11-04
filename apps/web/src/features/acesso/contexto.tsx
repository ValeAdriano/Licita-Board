import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { chamar } from '../../api/cliente'

// Dados do shell (RF-01.14): quem sou, em quais empresas e qual está selecionada, e as notificações.
// A empresa escolhida fica só em memória; a API confere a permissão em toda chamada.
export interface Vinculo {
  id: string
  empresaId: string
  empresa: string
  papel: string
  ativo: boolean
  permissoes: string[]
}
export interface Usuario {
  id: string
  email: string
  nome: string
  telefone: string | null
  oab: string | null
  superadmin: boolean
  temMfa: boolean
}
export interface Notificacao {
  id: string
  empresaId: string | null
  titulo: string
  corpo: string | null
  lidaEm: string | null
  criadaEm: string
}

interface Acesso {
  usuario: Usuario | null
  vinculos: Vinculo[]
  empresa: Vinculo | null
  escolherEmpresa(id: string): void
  // Só para mostrar ou esconder tela: quem decide é a API (guard + RLS).
  pode(modulo: string, acao: string): boolean
  notificacoes: Notificacao[]
  naoLidas: number
  marcarLida(id: string): Promise<void>
  recarregar(): Promise<void>
}

const Contexto = createContext<Acesso | null>(null)

export function useAcesso(): Acesso {
  const a = useContext(Contexto)
  if (!a) throw new Error('useAcesso fora do AcessoProvider')
  return a
}

export const INTERVALO_NOTIFICACOES_MS = 60000

// Módulos com ao menos uma ação, a partir de "modulo:acao".
export function modulosDe(permissoes: string[]): string[] {
  return [...new Set(permissoes.map((p) => p.split(':')[0] ?? ''))].filter(Boolean).sort()
}

interface Me {
  usuario: Usuario
  vinculos: Vinculo[]
}
interface EmpresaResumo {
  id: string
  razaoSocial: string
}
// SUPERADMIN administra todas as empresas, tenha vínculo ou não: as sem vínculo entram no seletor como
// "SUPERADMIN" (sem permissões listadas; `pode()` já libera tudo para ele e a API confere de novo).
export function empresasDoSuperadmin(vinculos: Vinculo[], empresas: EmpresaResumo[]): Vinculo[] {
  const com = new Set(vinculos.map((v) => v.empresaId))
  const sinteticos = empresas
    .filter((e) => !com.has(e.id))
    .map((e): Vinculo => ({ id: `superadmin:${e.id}`, empresaId: e.id, empresa: e.razaoSocial, papel: 'SUPERADMIN', ativo: true, permissoes: [] }))
  return [...vinculos, ...sinteticos]
}
const buscarMe = async (): Promise<Me> => {
  const me = await chamar<Me>('GET', '/me')
  if (!me.usuario.superadmin) return me
  const empresas = await chamar<EmpresaResumo[]>('GET', '/empresas').catch(() => [] as EmpresaResumo[])
  return { ...me, vinculos: empresasDoSuperadmin(me.vinculos.filter((v) => v.ativo), empresas) }
}
// Polling marcado como fundo: não renova a inatividade (T5.17).
const buscarNotificacoes = () => chamar<Notificacao[]>('GET', '/notificacoes', undefined, { fundo: true }).catch(() => null)

export function AcessoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])

  const aplicarMe = useCallback((me: Me) => {
    setUsuario(me.usuario)
    setVinculos(me.vinculos.filter((v) => v.ativo))
  }, [])
  const aplicarNotificacoes = useCallback((lista: Notificacao[] | null) => {
    if (lista) setNotificacoes(lista)
  }, [])

  const recarregar = useCallback(() => buscarMe().then(aplicarMe), [aplicarMe])

  // Aba oculta não consulta.
  useEffect(() => {
    void buscarMe().then(aplicarMe).catch(() => {})
    void buscarNotificacoes().then(aplicarNotificacoes)
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void buscarNotificacoes().then(aplicarNotificacoes)
    }, INTERVALO_NOTIFICACOES_MS)
    return () => clearInterval(id)
  }, [aplicarMe, aplicarNotificacoes])

  const marcarLida = useCallback(
    async (id: string) => {
      await chamar('POST', `/notificacoes/${id}/lida`)
      aplicarNotificacoes(await buscarNotificacoes())
    },
    [aplicarNotificacoes],
  )

  const valor = useMemo<Acesso>(() => {
    const empresa = vinculos.find((v) => v.empresaId === escolhida) ?? vinculos[0] ?? null
    return {
      usuario,
      vinculos,
      empresa,
      escolherEmpresa: setEscolhida,
      pode: (modulo, acao) => Boolean(usuario?.superadmin) || Boolean(empresa?.permissoes.includes(`${modulo}:${acao}`)),
      notificacoes,
      naoLidas: notificacoes.filter((n) => !n.lidaEm).length,
      marcarLida,
      recarregar,
    }
  }, [usuario, vinculos, escolhida, notificacoes, marcarLida, recarregar])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
