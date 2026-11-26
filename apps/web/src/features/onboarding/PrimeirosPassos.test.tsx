import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrimeirosPassos } from './PrimeirosPassos'

const mocks = vi.hoisted(() => ({ papel: 'ADMIN_EMPRESA', pode: vi.fn() }))
vi.mock('../acesso/contexto', () => ({
  useAcesso: () => ({ empresa: { empresaId: 'e1', papel: mocks.papel }, pode: mocks.pode }),
}))

const ficha = { logradouro: 'Rua A', municipio: 'Recife', uf: 'PE', cep: '50000000', regimeTributario: 'SIMPLES_NACIONAL' }
let dados: Record<string, unknown>
const fetchMock = vi.fn((url: string) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(dados[url.split('/e1')[1] ?? '']) } as Response),
)
const montar = () => render(<MemoryRouter><PrimeirosPassos /></MemoryRouter>)

beforeEach(() => {
  mocks.papel = 'ADMIN_EMPRESA'
  mocks.pode.mockReset().mockReturnValue(true)
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  dados = { '': {}, '/representantes': [], '/documentos': [], '/palavras-chave': { termos: [] } }
})

describe('Primeiros passos', () => {
  it('conta recém-criada: mostra os quatro passos com link para a aba certa', async () => {
    montar()
    expect(await screen.findByText('0 de 4 concluídos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cadastrar representante/ })).toHaveAttribute('href', '/cadastros?aba=representantes')
  })

  it('conta o que já foi preenchido', async () => {
    dados = { ...dados, '': ficha, '/palavras-chave': { termos: [{ id: 't' }] } }
    montar()
    expect(await screen.findByText('2 de 4 concluídos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Completar dados/ })).toBeNull()
  })

  it('tudo pronto: some', async () => {
    dados = { '': ficha, '/representantes': [{}], '/documentos': [{}], '/palavras-chave': { termos: [{}] } }
    const { container } = montar()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('quem não é administrador da empresa não vê nem busca', () => {
    mocks.papel = 'ANALISTA'
    const { container } = montar()
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
