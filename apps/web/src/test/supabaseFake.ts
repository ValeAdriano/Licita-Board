import { vi } from 'vitest'

// Supabase simulado para testes de tela. Cada teste ajusta `estado` antes de renderizar.
export const estado = {
  session: null as null | { user: { id: string; email: string }; access_token: string },
  aal: 'aal1' as 'aal1' | 'aal2',
  fatores: [] as { id: string; status: string; factor_type: string }[],
  usuario: { nome: 'Teste', superadmin: false } as { nome: string; superadmin: boolean } | null,
  papeis: [] as string[],
  recuperacao: false,
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
          : { data: estado.papeis.map((papel) => ({ papel, id: papel, empresas: null })), error: null },
      ),
    rpc: () => consulta(() => ({ data: [], error: null })),
  }),
}

export function resetarEstado() {
  estado.session = null
  estado.aal = 'aal1'
  estado.fatores = []
  estado.usuario = { nome: 'Teste', superadmin: false }
  estado.papeis = []
  estado.recuperacao = false
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
