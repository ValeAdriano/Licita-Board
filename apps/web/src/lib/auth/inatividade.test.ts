import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inativoDemais, LIMITE_INATIVIDADE_MS, marcarAtividade, useLogoutPorInatividade } from './inatividade'

beforeEach(() => localStorage.clear())

describe('inativoDemais', () => {
  it('30 min é o limite padrão', () => {
    expect(LIMITE_INATIVIDADE_MS).toBe(1_800_000)
  })
  it('expira exatamente no limite', () => {
    expect(inativoDemais(0, LIMITE_INATIVIDADE_MS)).toBe(true)
    expect(inativoDemais(0, LIMITE_INATIVIDADE_MS - 1)).toBe(false)
  })
  it('sem registro de atividade falha fechado', () => {
    expect(inativoDemais(null, Date.now())).toBe(true)
  })
})

describe('useLogoutPorInatividade', () => {
  it('app reaberto depois do limite expira na hora, sem zerar o contador', () => {
    marcarAtividade(Date.now() - LIMITE_INATIVIDADE_MS - 1000)
    const aoExpirar = vi.fn()
    renderHook(() => useLogoutPorInatividade(true, aoExpirar))
    expect(aoExpirar).toHaveBeenCalledOnce()
  })
  it('sessão restaurada sem registro de atividade expira', () => {
    const aoExpirar = vi.fn()
    renderHook(() => useLogoutPorInatividade(true, aoExpirar))
    expect(aoExpirar).toHaveBeenCalledOnce()
  })
  it('atividade recente não expira', () => {
    marcarAtividade(Date.now() - 60_000)
    const aoExpirar = vi.fn()
    renderHook(() => useLogoutPorInatividade(true, aoExpirar))
    expect(aoExpirar).not.toHaveBeenCalled()
  })
})
