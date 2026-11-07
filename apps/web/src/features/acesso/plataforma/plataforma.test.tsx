import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { empresasDoSuperadmin } from '../contexto'
import { Empresas } from './Empresas'
import { Exclusoes } from './Exclusoes'
import { NovaEmpresa } from './NovaEmpresa'
import { SolicitarExclusao } from './SolicitarExclusao'
import { podeDecidir, type PedidoExclusao } from './tipos'

const mocks = vi.hoisted(() => ({ stepUp: vi.fn(), recarregar: vi.fn(), escolherEmpresa: vi.fn(), usuario: { id: 'eu' } }))
vi.mock('../../../auth/sessao', () => ({ useSessao: () => ({ stepUp: mocks.stepUp }) }))
vi.mock('../contexto', async (original) => ({
  ...(await original<typeof import('../contexto')>()),
  useAcesso: () => ({ usuario: mocks.usuario, recarregar: mocks.recarregar, escolherEmpresa: mocks.escolherEmpresa, pode: () => true }),
}))

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response
}
const fetchMock = vi.fn()
const empresa = { id: 'e1', razaoSocial: 'Alfa Ltda', nomeFantasia: null, cnpj: '11222333000181' }
const pedido = (extra: Partial<PedidoExclusao> = {}): PedidoExclusao => ({
  id: 'p1', tabela: 'core.empresas', alvoId: 'e1', motivo: 'Encerramento de contrato', status: 'pendente', solicitadoPor: 'outro',
  solicitadoEm: '2026-11-04T12:00:00Z', expiraEm: new Date(Date.now() + 3600_000).toISOString(),
  resumo: { razao_social: 'Alfa Ltda', cnpj: '11222333000181' }, ...extra,
})

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(resposta(200, {}))
  mocks.stepUp.mockReset().mockResolvedValue('step-up-1')
  mocks.recarregar.mockReset().mockResolvedValue(undefined)
  mocks.escolherEmpresa.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('NovaEmpresa', () => {
  it('CNPJ inválido não chega na API; válido vai normalizado', async () => {
    const u = userEvent.setup()
    const aoConcluir = vi.fn()
    render(<NovaEmpresa aoConcluir={aoConcluir} aoCancelar={vi.fn()} />)
    await u.type(screen.getByLabelText('Razão social'), 'Alfa Ltda')
    await u.type(screen.getByLabelText('CNPJ'), '11.222.333/0001-82')
    await u.click(screen.getByRole('button', { name: 'Cadastrar empresa' }))
    expect(screen.getByText(/CNPJ inválido/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await u.clear(screen.getByLabelText('CNPJ'))
    await u.type(screen.getByLabelText('CNPJ'), '11.222.333/0001-81')
    await u.click(screen.getByRole('button', { name: 'Cadastrar empresa' }))
    await waitFor(() => expect(aoConcluir).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/empresas')
    expect(JSON.parse(init.body as string)).toEqual({ razaoSocial: 'Alfa Ltda', cnpj: '11222333000181' })
  })

  it('mostra a recusa da API (ex.: não é SUPERADMIN) sem fingir que cadastrou', async () => {
    fetchMock.mockResolvedValue(resposta(403, {}))
    const u = userEvent.setup()
    const aoConcluir = vi.fn()
    render(<NovaEmpresa aoConcluir={aoConcluir} aoCancelar={vi.fn()} />)
    await u.type(screen.getByLabelText('Razão social'), 'Alfa Ltda')
    await u.type(screen.getByLabelText('CNPJ'), '11222333000181')
    await u.click(screen.getByRole('button', { name: 'Cadastrar empresa' }))
    expect(await screen.findByText('Você não tem permissão para isso.')).toBeInTheDocument()
    expect(aoConcluir).not.toHaveBeenCalled()
  })
})

describe('SolicitarExclusao', () => {
  it('exige motivo, pede step-up de exclusão e só então envia o pedido', async () => {
    const u = userEvent.setup()
    const aoConcluir = vi.fn()
    render(<SolicitarExclusao empresa={empresa} aoConcluir={aoConcluir} aoCancelar={vi.fn()} />)
    await u.type(screen.getByLabelText('Motivo'), 'curto')
    await u.click(screen.getByRole('button', { name: 'Pedir exclusão' }))
    expect(screen.getByText(/pelo menos 10/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    await u.clear(screen.getByLabelText('Motivo'))
    await u.type(screen.getByLabelText('Motivo'), 'Encerramento de contrato')
    await u.click(screen.getByRole('button', { name: 'Pedir exclusão' }))
    await u.type(screen.getByLabelText('Código do autenticador'), '123456')
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(aoConcluir).toHaveBeenCalled())
    expect(mocks.stepUp).toHaveBeenCalledWith('exclusao_definitiva', '123456')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/exclusoes')
    expect(JSON.parse(init.body as string)).toEqual({ tabela: 'core.empresas', id: 'e1', motivo: 'Encerramento de contrato', stepUp: 'step-up-1' })
  })
})

describe('Exclusoes', () => {
  it('pedido de outro SUPERADMIN: aprovar passa pelo step-up e envia a decisão', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.endsWith('/exclusoes') ? resposta(200, [pedido()]) : resposta(204, {})))
    const u = userEvent.setup()
    render(<Exclusoes />)
    await u.click(await screen.findByRole('button', { name: 'Aprovar e excluir' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Alfa Ltda')
    await u.type(screen.getByLabelText('Código do autenticador'), '123456')
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.recarregar).toHaveBeenCalled())
    const chamada = fetchMock.mock.calls.find(([url]) => String(url).includes('/decidir')) as [string, RequestInit]
    expect(chamada[0]).toContain('/exclusoes/p1/decidir')
    expect(JSON.parse(chamada[1].body as string)).toEqual({ aprovar: true, stepUp: 'step-up-1' })
    expect(mocks.stepUp).toHaveBeenCalledWith('exclusao_definitiva', '123456')
  })

  it('o próprio pedido não tem botão de decidir; pedido vencido ou já decidido também não', async () => {
    fetchMock.mockResolvedValue(resposta(200, [pedido({ solicitadoPor: 'eu' })]))
    render(<Exclusoes />)
    expect(await screen.findByText('Outro SUPERADMIN precisa decidir.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar e excluir' })).toBeNull()
    expect(podeDecidir(pedido({ expiraEm: '2020-01-01T00:00:00Z' }), 'eu')).toBe(false)
    expect(podeDecidir(pedido({ status: 'executada' }), 'eu')).toBe(false)
    expect(podeDecidir(pedido(), 'eu')).toBe(true)
  })
})

describe('Empresas', () => {
  it('lista com CNPJ legível; Abrir escolhe a empresa', async () => {
    fetchMock.mockResolvedValue(resposta(200, [empresa]))
    const u = userEvent.setup()
    render(
      <MemoryRouter>
        <Empresas />
      </MemoryRouter>,
    )
    expect(await screen.findByText('CNPJ 11.222.333/0001-81')).toBeInTheDocument()
    await u.click(screen.getAllByRole('button', { name: 'Abrir Alfa Ltda' })[0])
    expect(mocks.escolherEmpresa).toHaveBeenCalledWith('e1')
  })
})

describe('empresasDoSuperadmin', () => {
  it('acrescenta as empresas sem vínculo como SUPERADMIN, sem duplicar as que já têm', () => {
    const v = { id: 'v1', empresaId: 'e1', empresa: 'Alfa', papel: 'ADMIN_EMPRESA', ativo: true, permissoes: ['x:y'] }
    const r = empresasDoSuperadmin([v], [{ id: 'e1', razaoSocial: 'Alfa' }, { id: 'e2', razaoSocial: 'Beta' }])
    expect(r).toHaveLength(2)
    expect(r[0]).toBe(v)
    expect(r[1]).toMatchObject({ empresaId: 'e2', empresa: 'Beta', papel: 'SUPERADMIN', ativo: true, permissoes: [] })
  })
})
