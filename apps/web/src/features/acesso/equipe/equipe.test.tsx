import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvidarUsuario } from './ConvidarUsuario'
import { cnpjLegivel, ConvitesRecebidos } from './ConvitesRecebidos'
import { EditorVinculo } from './EditorVinculo'
import { MatrizEditavel } from './MatrizEditavel'
import type { Membro } from './tipos'
import { convitePendente } from './tipos'

const mocks = vi.hoisted(() => ({ stepUp: vi.fn(), recarregar: vi.fn() }))
vi.mock('../../../auth/sessao', () => ({ useSessao: () => ({ stepUp: mocks.stepUp }) }))
vi.mock('../contexto', () => ({ useAcesso: () => ({ recarregar: mocks.recarregar, pode: () => true }) }))

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response
}

const modulos = [{ slug: 'agenda', nome: 'Agenda' }]
const membro: Membro = {
  vinculoId: 'v1', usuarioId: 'u1', nome: 'Bia', email: 'bia@teste.local', papel: 'OPERADOR',
  ativo: true, permissoes: ['agenda:visualizar'],
}
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(resposta(200, {}))
  mocks.stepUp.mockReset().mockResolvedValue('step-up-1')
  mocks.recarregar.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', fetchMock)
})

function abrir(podeAdministrar = true, m = membro) {
  const aoSalvar = vi.fn()
  render(<EditorVinculo membro={m} modulos={modulos} podeAdministrar={podeAdministrar} aoSalvar={aoSalvar} aoFechar={vi.fn()} />)
  return aoSalvar
}
const marcar = (rotulo: string) => screen.getByRole('checkbox', { name: rotulo })

describe('EditorVinculo', () => {
  it('sem alteração, salvar fica desabilitado e não abre a confirmação', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('salvar pede step-up e grava exatamente o que estava na tela ao confirmar', async () => {
    const u = userEvent.setup()
    const aoSalvar = abrir()
    await u.click(marcar('Agenda: Editar'))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await u.type(screen.getByLabelText('Código do autenticador'), '123456')
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(aoSalvar).toHaveBeenCalled())
    expect(mocks.stepUp).toHaveBeenCalledWith('alterar_permissoes', '123456')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/vinculos/v1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      papel: 'OPERADOR', ativo: true, permissoes: ['agenda:editar', 'agenda:visualizar'], stepUp: 'step-up-1',
    })
    expect(mocks.recarregar).toHaveBeenCalled()
  })

  it('mostra a recusa da API sem fingir que salvou', async () => {
    fetchMock.mockResolvedValue(resposta(400, { message: 'permissão excede o que você tem' }))
    const u = userEvent.setup()
    const aoSalvar = abrir()
    await u.click(marcar('Agenda: Editar'))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await u.type(screen.getByLabelText('Código do autenticador'), '123456')
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.getByText(/permissão excede o que você tem/)).toBeInTheDocument())
    expect(screen.getByText(/aguarde o próximo código/)).toBeInTheDocument()
    expect(aoSalvar).not.toHaveBeenCalled()
  })

  it('sem permissão para administrar, a matriz fica travada e não há como salvar', () => {
    abrir(false)
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull()
    expect(marcar('Agenda: Editar')).toBeDisabled()
  })

  it('papel CLIENTE só aceita a ação visualizar', () => {
    abrir(true, { ...membro, papel: 'CLIENTE' })
    expect(marcar('Agenda: Editar')).toBeDisabled()
    expect(marcar('Agenda: Visualizar')).toBeEnabled()
  })
})

describe('StepUpModal (pelo editor)', () => {
  async function abrirConfirmacao() {
    const u = userEvent.setup()
    const aoSalvar = abrir()
    await u.click(marcar('Agenda: Editar'))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await u.type(screen.getByLabelText('Código do autenticador'), '123456')
    return { u, aoSalvar }
  }

  it('mostra o resumo do que será gravado antes do código', async () => {
    await abrirConfirmacao()
    expect(screen.getByText('Alterar: Bia')).toBeInTheDocument()
    expect(screen.getByText('Papel: Operador · acesso ativo')).toBeInTheDocument()
    expect(screen.getByText('Permissões: +1 · −0 (total 2)')).toBeInTheDocument()
  })

  it('Enter duplo manda o código uma vez só (o repetido contaria erro de MFA)', async () => {
    let liberar: (id: string) => void = () => {}
    mocks.stepUp.mockReturnValue(new Promise<string>((ok) => (liberar = ok)))
    const { u } = await abrirConfirmacao()
    await u.type(screen.getByLabelText('Código do autenticador'), '{Enter}{Enter}')
    expect(mocks.stepUp).toHaveBeenCalledTimes(1)
    liberar('step-up-1')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('o mesmo código não é reenviado depois de usado', async () => {
    fetchMock.mockResolvedValue(resposta(400, { message: 'recusado' }))
    const { u } = await abrirConfirmacao()
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.getByText(/recusado/)).toBeInTheDocument())
    expect(mocks.stepUp).toHaveBeenCalledTimes(1)
    // reabre a confirmação com o mesmo código na tela do autenticador
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await u.type(screen.getByLabelText('Código do autenticador'), '123456')
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(screen.getByText(/Esse código já foi usado/)).toBeInTheDocument()
    expect(mocks.stepUp).toHaveBeenCalledTimes(1)
  })

  it('cancelar durante a conferência do código impede a operação crítica', async () => {
    let liberar: (id: string) => void = () => {}
    mocks.stepUp.mockReturnValue(new Promise<string>((ok) => (liberar = ok)))
    const { u, aoSalvar } = await abrirConfirmacao()
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    liberar('step-up-1')
    await waitFor(() => expect(mocks.stepUp).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(aoSalvar).not.toHaveBeenCalled()
  })

  it('Esc fecha a confirmação (e devolve o foco)', async () => {
    const { u } = await abrirConfirmacao()
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('MatrizEditavel: teto de concessão', () => {
  it('trava o que quem concede não tem, mas deixa remover o que já estava marcado', () => {
    render(
      <MatrizEditavel modulos={modulos} papel="OPERADOR" selecao={new Set(['agenda:exportar'])} aoMudar={vi.fn()} somenteLeitura={false} podeConceder={(_m, a) => a === 'editar'} />,
    )
    expect(marcar('Agenda: Editar')).toBeEnabled()
    expect(marcar('Agenda: Cadastrar')).toBeDisabled()
    expect(marcar('Agenda: Exportar')).toBeEnabled()
  })
})

describe('ConvidarUsuario', () => {
  it('começa sem nenhuma permissão marcada e pede um e-mail válido antes do step-up', async () => {
    const u = userEvent.setup()
    render(<ConvidarUsuario empresaId="e1" modulos={modulos} aoConcluir={vi.fn()} aoCancelar={vi.fn()} />)
    expect(screen.queryByText(/✓/)).toBeNull()
    await u.type(screen.getByLabelText('E-mail do convidado'), 'isso-nao-e-email')
    await u.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect(screen.getByText('Informe um e-mail válido.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mostra no resumo quem será convidado e com quantas permissões', async () => {
    const u = userEvent.setup()
    render(<ConvidarUsuario empresaId="e1" modulos={modulos} aoConcluir={vi.fn()} aoCancelar={vi.fn()} />)
    await u.type(screen.getByLabelText('E-mail do convidado'), 'nova@teste.local')
    await u.click(marcar('Agenda: Visualizar'))
    await u.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect(screen.getByText('Convidar: nova@teste.local')).toBeInTheDocument()
    expect(screen.getByText('Permissões: 1')).toBeInTheDocument()
  })
})

describe('ConvitesRecebidos (T3.1c)', () => {
  const convite = {
    id: 'c1', empresa: 'Alfa Ltda', cnpj: '11222333000181', convidado_por: 'Admin Demo',
    papel: 'OPERADOR', permissoes: ['agenda:visualizar'], expira_em: '2026-11-10T00:00:00Z',
  }

  it('mostra CNPJ e quem convidou e só aceita depois da revisão', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(resposta(200, url.endsWith('/me/convites') ? [convite] : {})))
    const u = userEvent.setup()
    render(<ConvitesRecebidos />)
    await waitFor(() => expect(screen.getByText('Alfa Ltda')).toBeInTheDocument())
    expect(screen.getByText('CNPJ 11.222.333/0001-81')).toBeInTheDocument()
    expect(screen.getByText(/Convidado por/)).toBeInTheDocument()
    expect(screen.getByText('Admin Demo')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([x]) => String(x).includes('/aceitar'))).toBe(false)
    await u.click(screen.getByRole('button', { name: 'Revisar convite' }))
    await u.click(screen.getByRole('button', { name: 'Confirmar e aceitar' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([x]) => String(x).includes('/me/convites/c1/aceitar'))).toBe(true))
  })

  it('formata o CNPJ numérico e o alfanumérico', () => {
    expect(cnpjLegivel('11222333000181')).toBe('11.222.333/0001-81')
    expect(cnpjLegivel('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
    expect(cnpjLegivel('inválido')).toBe('inválido')
  })
})

describe('convitePendente', () => {
  const base = { id: 'c', email: 'a@b.c', papel: 'OPERADOR' as const, permissoes: [], criadoEm: '2026-11-01T00:00:00Z', aceitoEm: null, revogadoEm: null }
  const agora = new Date('2026-11-03T12:00:00Z').getTime()

  it('pendente só se não aceito, não revogado e não vencido', () => {
    expect(convitePendente({ ...base, expiraEm: '2026-11-08T00:00:00Z' }, agora)).toBe(true)
    expect(convitePendente({ ...base, expiraEm: '2026-11-02T00:00:00Z' }, agora)).toBe(false)
    expect(convitePendente({ ...base, expiraEm: '2026-11-08T00:00:00Z', aceitoEm: '2026-11-03T00:00:00Z' }, agora)).toBe(false)
    expect(convitePendente({ ...base, expiraEm: '2026-11-08T00:00:00Z', revogadoEm: '2026-11-03T00:00:00Z' }, agora)).toBe(false)
  })
})
