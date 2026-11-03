import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcessoProvider, INTERVALO_NOTIFICACOES_MS, modulosDe, useAcesso } from './contexto'

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response
}

const ME = {
  usuario: { id: 'u1', email: 'a@teste.local', nome: 'Ana', telefone: null, oab: null, superadmin: false, temMfa: true },
  vinculos: [
    { id: 'v1', empresaId: 'e1', empresa: 'Alfa', papel: 'CLIENTE', ativo: true, permissoes: ['agenda:visualizar'] },
    { id: 'v2', empresaId: 'e2', empresa: 'Inativa', papel: 'CLIENTE', ativo: false, permissoes: [] },
  ],
}

function Sonda() {
  const a = useAcesso()
  return (
    <>
      <p>empresa:{a.empresa?.empresa ?? '-'}</p>
      <p>vinculos:{a.vinculos.length}</p>
      <p>naoLidas:{a.naoLidas}</p>
      <p>pode-agenda:{String(a.pode('agenda', 'visualizar'))}</p>
      <p>pode-usuarios:{String(a.pode('usuarios', 'visualizar'))}</p>
    </>
  )
}

const fetchMock = vi.fn((url: string) =>
  Promise.resolve(url.endsWith('/me') ? resposta(200, ME) : resposta(200, [{ id: 'n1', empresaId: 'e1', titulo: 'Aviso', corpo: null, lidaEm: null, criadaEm: '2026-11-03T12:00:00Z' }])),
)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AcessoProvider', () => {
  it('mostra só vínculos ativos, seleciona o primeiro, conta as não lidas e responde pode()', async () => {
    render(<AcessoProvider><Sonda /></AcessoProvider>)
    await waitFor(() => expect(screen.getByText('empresa:Alfa')).toBeInTheDocument())
    expect(screen.getByText('vinculos:1')).toBeInTheDocument()
    expect(screen.getByText('naoLidas:1')).toBeInTheDocument()
    expect(screen.getByText('pode-agenda:true')).toBeInTheDocument()
    expect(screen.getByText('pode-usuarios:false')).toBeInTheDocument()
  })

  it('o polling de notificações vai marcado como fundo (não renova a inatividade)', async () => {
    render(<AcessoProvider><Sonda /></AcessoProvider>)
    await waitFor(() => expect(screen.getByText('naoLidas:1')).toBeInTheDocument())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_NOTIFICACOES_MS)
    })
    const polls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/notificacoes'))
    expect(polls.length).toBeGreaterThanOrEqual(2)
    for (const [, init] of polls as unknown as [string, RequestInit][]) {
      expect(init.headers).toMatchObject({ 'X-VV-Fundo': '1' })
    }
    const me = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/me')) as unknown as [string, RequestInit]
    expect(me[1].headers).not.toHaveProperty('X-VV-Fundo')
  })
})

describe('modulosDe', () => {
  it('agrupa as permissões por módulo, sem repetir', () => {
    expect(modulosDe(['editais:visualizar', 'agenda:editar', 'agenda:visualizar'])).toEqual(['agenda', 'editais'])
  })
})
