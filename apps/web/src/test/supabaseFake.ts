import { vi } from 'vitest'

// Supabase simulado para testes de tela. Cada teste ajusta `estado` antes de renderizar.
export const estado = {
  session: null as null | { user: { id: string; email: string }; access_token: string },
  aal: 'aal1' as 'aal1' | 'aal2',
  fatores: [] as { id: string; status: string; factor_type: string }[],
  usuario: { nome: 'Teste', superadmin: false } as { nome: string; superadmin: boolean } | null,
  papeis: [] as string[],
  recuperacao: false,
  empresas: [] as { id: string; razao_social: string; nome_fantasia: string | null }[],
  naoLidas: 0,
  /** has_permission por 'modulo:acao' (verdadeiro se estiver na lista). */
  podeNaEmpresa: [] as string[],
  vinculos: [] as unknown[],
  convites: [] as unknown[],
  permissoes: [] as { modulo: string; acao: string }[],
  meusConvites: [] as unknown[],
  modulos: [
    { slug: 'empresas', nome: 'Empresas' },
    { slug: 'documentos', nome: 'Documentos' },
  ],
  falharPerfil: false,
  falharSignOut: false,
}

function consulta(resultado: () => unknown) {
  const alvo: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(alvo, {
    get(_, prop) {
      if (prop === 'then') return (ok: (v: unknown) => void) => ok(resultado())
      if (prop === 'maybeSingle') return () => Promise.resolve(resultado())
      return () => proxy
    },
  })
  return proxy
}

export const signInWithPassword = vi.fn()
export const challengeAndVerify = vi.fn(async () => ({ data: {}, error: null }))
export const rpcChamadas: { nome: string; args: Record<string, unknown> }[] = []
export const resetPasswordForEmail = vi.fn()

export const supabaseFake = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: estado.session } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    signInWithPassword,
    resetPasswordForEmail,
    signOut: vi.fn(async () => ({ error: estado.falharSignOut ? { name: 'AuthRetryableFetchError' } : null })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: estado.aal }, error: null })),
      challengeAndVerify,
      listFactors: vi.fn(async () => ({
        data: { totp: estado.fatores.filter((f) => f.status === 'verified'), all: estado.fatores },
        error: null,
      })),
    },
  },
  schema: () => ({
    from: (tabela: string) =>
      consulta(() =>
        estado.falharPerfil
          ? { data: null, error: { message: 'rede' } }
          : tabela === 'usuarios'
          ? { data: estado.usuario, error: null }
          : tabela === 'empresas'
          ? { data: estado.empresas, error: null }
          : tabela === 'notificacoes'
          ? { data: [], count: estado.naoLidas, error: null }
          : tabela === 'modulos'
          ? { data: estado.modulos, error: null }
          : tabela === 'convites'
          ? { data: estado.convites, error: null }
          : tabela === 'permissoes'
          ? { data: estado.permissoes, error: null }
          : tabela === 'vinculos' && estado.vinculos.length
          ? { data: estado.vinculos, error: null }
          : { data: estado.papeis.map((papel) => ({ papel, id: papel, empresas: null })), error: null },
      ),
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      rpcChamadas.push({ nome, args })
      return consulta(() => {
        if (nome === 'has_permission') return { data: estado.podeNaEmpresa.includes(`${args.p_modulo}:${args.p_acao}`), error: null }
        if (nome === 'iniciar_step_up') return { data: 'token-step-up', error: null }
        if (nome === 'meus_convites') return { data: estado.meusConvites, error: null }
        return { data: [], error: null }
      })
    },
  }),
}

export function resetarEstado() {
  estado.session = null
  estado.aal = 'aal1'
  estado.fatores = []
  estado.usuario = { nome: 'Teste', superadmin: false }
  estado.papeis = []
  estado.recuperacao = false
  estado.empresas = []
  estado.naoLidas = 0
  estado.podeNaEmpresa = []
  estado.vinculos = []
  estado.convites = []
  estado.permissoes = []
  estado.meusConvites = []
  rpcChamadas.length = 0
  challengeAndVerify.mockClear()
  estado.falharPerfil = false
  estado.falharSignOut = false
  localStorage.clear()
}

export function logado() {
  estado.session = { user: { id: 'u1', email: 'teste@vv.local' }, access_token: 'tk' }
  localStorage.setItem('vv:ultima-atividade', String(Date.now()))
}

export const moduloSupabase = {
  supabase: supabaseFake,
  supabaseConfigurado: true,
  CHAVE_SESSAO: 'vv-auth',
  emRecuperacaoDeSenha: () => estado.recuperacao,
}
