import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Auditoria from './Auditoria'

const mocks = vi.hoisted(() => ({ pode: vi.fn() }))
vi.mock('../features/acesso/contexto', () => ({
  useAcesso: () => ({ empresa: { empresaId: 'e1', empresa: 'Alfa Ltda' }, pode: mocks.pode }),
}))

function resposta(corpo: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(corpo) } as Response
}
const fetchMock = vi.fn()

beforeEach(() => {
  mocks.pode.mockReset().mockReturnValue(true)
  fetchMock.mockReset().mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith('/auditoria')
        ? resposta([{ id: 'a1', em: '2026-11-04T15:00:00Z', autor: 'u1', tabela: 'permissoes', operacao: 'INSERT', registro: null, campos: null }])
        : resposta([{ vinculoId: 'v1', usuarioId: 'u1', nome: 'Ana', email: 'ana@teste.local', papel: 'ADMIN_EMPRESA', ativo: true, permissoes: [] }]),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

describe('Auditoria', () => {
  it('mostra o que foi feito, por quem (nome da equipe) e quando', async () => {
    render(<Auditoria />)
    expect(await screen.findByText('Criou permissão')).toBeInTheDocument()
    expect(await screen.findAllByText(/Ana/)).not.toHaveLength(0)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/empresas/e1/auditoria')
  })

  it('sem auditoria/visualizar não chama a API e avisa', () => {
    mocks.pode.mockReturnValue(false)
    render(<Auditoria />)
    expect(screen.getByText(/não tem permissão para ver a auditoria/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
