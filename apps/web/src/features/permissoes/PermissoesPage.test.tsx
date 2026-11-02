import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { challengeAndVerify, estado, logado, moduloSupabase, resetarEstado, rpcChamadas } from '../../test/supabaseFake'

vi.mock('../../lib/supabase', () => moduloSupabase)
const { rotas } = await import('../../app/router')

function abrir(caminho: string) {
  const router = createMemoryRouter(rotas, { initialEntries: [caminho] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function adminLogado(pode: string[]) {
  logado()
  estado.papeis = ['ADMIN_EMPRESA']
  estado.aal = 'aal2'
  estado.fatores = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
  estado.empresas = [{ id: 'a', razao_social: 'Alfa Ltda', nome_fantasia: 'Alfa' }]
  estado.podeNaEmpresa = pode
  estado.vinculos = [
    { id: 'v1', papel: 'OPERADOR', ativo: true, usuario_id: 'u2', usuarios: { nome: 'Maria Operadora', email: 'maria@alfa.local' } },
  ]
  estado.convites = [{ id: 'c1', email: 'joao@alfa.local', papel: 'CLIENTE', created_at: '2026-11-01T12:00:00Z', expira_em: '2026-11-08T12:00:00Z' }]
  estado.permissoes = [{ modulo: 'empresas', acao: 'visualizar' }]
}

beforeEach(() => resetarEstado())

describe('Usuários e permissões', () => {
  it('sem usuarios/visualizar mostra aviso e não lista ninguém', async () => {
    adminLogado([])
    abrir('/permissoes')
    expect(await screen.findByText(/não tem permissão para ver os usuários/)).toBeInTheDocument()
    expect(screen.queryByText('Maria Operadora')).not.toBeInTheDocument()
  })

  it('admin altera a matriz e salva com reautenticação (step-up)', async () => {
    adminLogado(['usuarios:visualizar', 'permissoes:administrar_permissoes'])
    abrir('/permissoes')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Maria Operadora/ }))
    const tabela = await screen.findByRole('table')
    const editar = within(tabela).getByRole('checkbox', { name: 'Empresas: Editar' })
    expect(editar).not.toBeChecked()
    await user.click(editar)
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    const dialogo = await screen.findByRole('dialog')
    await user.type(within(dialogo).getByLabelText('Código do autenticador'), '123456')
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }))

    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' })
    const salvar = rpcChamadas.find((c) => c.nome === 'salvar_vinculo')
    expect(rpcChamadas.find((c) => c.nome === 'iniciar_step_up')?.args).toEqual({ p_escopo: 'alterar_permissoes' })
    expect(salvar?.args).toMatchObject({
      p_vinculo: 'v1',
      p_papel: 'OPERADOR',
      p_ativo: true,
      p_permissoes: ['empresas:editar', 'empresas:visualizar'],
      p_step_up: 'token-step-up',
    })
    expect(await screen.findByText('Permissões salvas.')).toBeInTheDocument()
  })

  it('quem só visualiza vê a matriz bloqueada e sem botão de salvar', async () => {
    adminLogado(['usuarios:visualizar'])
    abrir('/permissoes')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Maria Operadora/ }))
    const tabela = await screen.findByRole('table')
    expect(within(tabela).getByRole('checkbox', { name: 'Empresas: Visualizar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Convidar usuário' })).not.toBeInTheDocument()
  })

  it('ao trocar para CLIENTE, só a coluna Visualizar fica habilitada', async () => {
    adminLogado(['usuarios:visualizar', 'permissoes:administrar_permissoes'])
    abrir('/permissoes')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Maria Operadora/ }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Papel' }), 'CLIENTE')
    const tabela = screen.getByRole('table')
    expect(within(tabela).getByRole('checkbox', { name: 'Empresas: Editar' })).toBeDisabled()
    expect(within(tabela).getByRole('checkbox', { name: 'Empresas: Visualizar' })).toBeEnabled()
  })

  it('lista convites pendentes e permite revogar', async () => {
    adminLogado(['usuarios:visualizar', 'permissoes:visualizar', 'permissoes:administrar_permissoes'])
    abrir('/permissoes')
    const user = userEvent.setup()
    expect(await screen.findByText('joao@alfa.local')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revogar' }))
    expect(rpcChamadas.find((c) => c.nome === 'revogar_convite')?.args).toEqual({ p_convite: 'c1' })
  })
})

describe('Convites recebidos', () => {
  it('convidado aceita o convite', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    estado.meusConvites = [
      { id: 'c9', empresa: 'Alfa', papel: 'OPERADOR', permissoes: ['empresas:visualizar'], convidado_em: '2026-11-01', expira_em: '2026-11-08' },
    ]
    abrir('/convites')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Revisar e aceitar' }))
    expect(screen.getByText(/empresas: Visualizar/)).toBeInTheDocument()
    expect(rpcChamadas.find((c) => c.nome === 'aceitar_convite')).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Confirmar aceite' }))
    expect(rpcChamadas.find((c) => c.nome === 'aceitar_convite')?.args).toEqual({ p_convite: 'c9' })
    expect(await screen.findByText(/agora tem acesso a Alfa/)).toBeInTheDocument()
  })
})

describe('confirmação congelada', () => {
  it('o que é salvo é o estado do momento em que o modal abriu', async () => {
    adminLogado(['usuarios:visualizar', 'permissoes:visualizar', 'permissoes:administrar_permissoes'])
    abrir('/permissoes')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Maria Operadora/ }))
    const tabela = await screen.findByRole('table')
    await user.click(within(tabela).getByRole('checkbox', { name: 'Empresas: Editar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const dialogo = await screen.findByRole('dialog')
    // Mudança feita "por baixo" do modal não entra no que vai ser salvo.
    await user.click(within(tabela).getByRole('checkbox', { name: 'Documentos: Visualizar' }))
    await user.type(within(dialogo).getByLabelText('Código do autenticador'), '123456')
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }))
    const salvar = rpcChamadas.find((c) => c.nome === 'salvar_vinculo')
    expect(salvar?.args.p_permissoes).toEqual(['empresas:editar', 'empresas:visualizar'])
  })
})
