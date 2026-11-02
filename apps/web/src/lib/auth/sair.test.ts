import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.fn()
vi.mock('../supabase', () => ({ CHAVE_SESSAO: 'vv-auth', supabase: { auth: { signOut } } }))
const { sairForcado } = await import('./sair')

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('vv-auth', '{"access_token":"x"}')
  localStorage.setItem('vv-auth-code-verifier', 'y')
  localStorage.setItem('outra-chave', 'z')
})

describe('sairForcado', () => {
  it('signOut com erro (rede fora) apaga a sessão local à força', async () => {
    signOut.mockResolvedValue({ error: { name: 'AuthRetryableFetchError' } })
    const redirecionar = vi.fn()
    await sairForcado('inatividade', redirecionar)
    expect(localStorage.getItem('vv-auth')).toBeNull()
    expect(localStorage.getItem('vv-auth-code-verifier')).toBeNull()
    expect(localStorage.getItem('outra-chave')).toBe('z')
    expect(redirecionar).toHaveBeenCalledWith('/login?motivo=inatividade')
  })
  it('signOut que lança exceção também apaga a sessão', async () => {
    signOut.mockRejectedValue(new Error('offline'))
    const redirecionar = vi.fn()
    await sairForcado(undefined, redirecionar)
    expect(localStorage.getItem('vv-auth')).toBeNull()
    expect(redirecionar).toHaveBeenCalledWith('/login')
  })
})
