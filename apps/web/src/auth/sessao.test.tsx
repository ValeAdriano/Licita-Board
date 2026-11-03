import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chamar, limparCredenciais } from '../api/cliente'
import { SessaoProvider, useSessao } from './sessao'

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response
}

function Sonda() {
  const s = useSessao()
  return (
    <>
      <p>fase:{s.fase}</p>
      <button onClick={() => void s.entrar('a@b.c', 'senha-longa-123').catch(() => {})}>entrar</button>
      <button onClick={() => void s.elevar('verificar', '123456').then(s.concluirMfa)}>mfa</button>
      <button onClick={() => void s.sair().catch(() => {})}>sair</button>
      <button onClick={s.recarregar}>recarregar</button>
      <button onClick={() => void chamar('GET', '/me').catch(() => {})}>chamar-me</button>
      <button onClick={() => void s.elevar('verificar', '123456').catch((e: Error) => document.body.setAttribute('data-erro', e.message))}>elevar-codigo</button>
    </>
  )
}

const fetchMock = vi.fn()
const montar = () =>
  render(
    <SessaoProvider>
      <Sonda />
    </SessaoProvider>,
  )

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  limparCredenciais()
  vi.unstubAllGlobals()
})

describe('SessaoProvider', () => {
  it('sem sessão no cookie (401) começa anônimo', async () => {
    fetchMock.mockResolvedValueOnce(resposta(401, {}))
    montar()
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeInTheDocument())
  })

  it('login pede MFA, a verificação ativa e sair volta para anônimo; nada de token no corpo do login', async () => {
    fetchMock.mockResolvedValueOnce(resposta(401, {}))
    montar()
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeInTheDocument())
    const u = userEvent.setup()

    fetchMock.mockResolvedValueOnce(resposta(200, { mfa: 'verificar', csrf: 'c1' }))
    await u.click(screen.getByText('entrar'))
    await waitFor(() => expect(screen.getByText('fase:mfa')).toBeInTheDocument())
    const [, login] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(login.body as string)).toMatchObject({ plataforma: 'web' })

    fetchMock.mockResolvedValueOnce(resposta(200, {}))
    await u.click(screen.getByText('mfa'))
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[1].headers).toMatchObject({ 'X-CSRF-Token': 'c1' })

    fetchMock.mockResolvedValueOnce(resposta(204, null))
    await u.click(screen.getByText('sair'))
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeInTheDocument())
  })

  it('sessão do cookie que a API recusa (401) volta para anônimo', async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal2', mfa: 'nao_requerido', csrf: 'c' }))
    montar()
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(resposta(401, {}))
    await userEvent.setup().click(screen.getByText('chamar-me'))
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeInTheDocument())
  })

  it('sem rede no início oferece tentar de novo (nada é descartado)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    montar()
    await waitFor(() => expect(screen.getByText('fase:sem_conexao')).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal2', mfa: 'nao_requerido' }))
    await userEvent.setup().click(screen.getByText('recarregar'))
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
  })

  it('sair que o servidor não confirmou mantém a sessão (não finge que saiu)', async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal2', mfa: 'nao_requerido' }))
    montar()
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(resposta(503, {}))
    await userEvent.setup().click(screen.getByText('sair'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByText('fase:ativa')).toBeInTheDocument()
  })

  it('perfil que passa a exigir MFA (403 "MFA") leva da fase ativa para a verificação', async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal1', mfa: 'nao_requerido' }))
    montar()
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(resposta(403, { message: 'MFA' })).mockResolvedValueOnce(resposta(200, { aal: 'aal1', mfa: 'cadastrar' }))
    await userEvent.setup().click(screen.getByText('chamar-me'))
    await waitFor(() => expect(screen.getByText('fase:mfa')).toBeInTheDocument())
  })

  it('o mesmo código de autenticador não é enviado duas vezes (replay contaria erro de MFA)', async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal2', mfa: 'nao_requerido' }))
    montar()
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
    const u = userEvent.setup()
    fetchMock.mockResolvedValueOnce(resposta(200, {}))
    await u.click(screen.getByText('elevar-codigo'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await u.click(screen.getByText('elevar-codigo'))
    await waitFor(() => expect(document.body.getAttribute('data-erro')).toMatch(/já foi usado/))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    document.body.removeAttribute('data-erro')
  })

  it('aba que volta a ficar visível com outra conta logada recarrega (nada da conta anterior fica)', async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { usuarioId: 'u1', aal: 'aal2', mfa: 'nao_requerido', csrf: 'c1' }))
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, reload }, writable: true, configurable: true })
    montar()
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(resposta(200, { usuarioId: 'u2', aal: 'aal2', mfa: 'nao_requerido', csrf: 'c2' }))
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true })
  })
})
