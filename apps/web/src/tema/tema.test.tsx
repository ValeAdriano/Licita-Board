import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

let alterarSistema: () => void
let escuro = false
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  escuro = false
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return escuro },
    addEventListener: (_: string, callback: () => void) => { alterarSistema = callback },
  })))
})
it('oferece as três opções, persiste e acompanha o sistema apenas em Sistema', async () => {
  const { SeletorTema } = await import('./SeletorTema')
  const u = userEvent.setup()
  render(<SeletorTema />)
  const seletor = screen.getByRole('combobox', { name: 'Tema' })
  expect(seletor).toHaveValue('sistema')
  expect(document.documentElement).not.toHaveClass('dark-mode')
  await u.selectOptions(seletor, 'escuro')
  expect(document.documentElement).toHaveClass('dark-mode')
  expect(localStorage.getItem('vv.tema')).toBe('escuro')
  await u.selectOptions(seletor, 'claro')
  expect(document.documentElement).not.toHaveClass('dark-mode')
  expect(localStorage.getItem('vv.tema')).toBe('claro')
  act(() => { escuro = true; alterarSistema() })
  expect(document.documentElement).not.toHaveClass('dark-mode')
  await u.selectOptions(seletor, 'sistema')
  expect(localStorage.getItem('vv.tema')).toBe('sistema')
  expect(document.documentElement).toHaveClass('dark-mode')
  act(() => { escuro = false; alterarSistema() })
  expect(document.documentElement).not.toHaveClass('dark-mode')
})
it('restaura a preferência antes da renderização e atualiza a cor do navegador', async () => {
  localStorage.setItem('vv.tema', 'escuro')
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">'
  const tema = await import('./tema')
  expect(tema.obterTema()).toBe('escuro')
  expect(document.documentElement).toHaveClass('dark-mode')
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#0c0e12')
})
it('valor inválido usa Sistema; armazenamento bloqueado não impede a troca', async () => {
  localStorage.setItem('vv.tema', 'invalido')
  const tema = await import('./tema')
  expect(tema.obterTema()).toBe('sistema')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
  expect(() => tema.definirTema('escuro')).not.toThrow()
  expect(document.documentElement).toHaveClass('dark-mode')
})
