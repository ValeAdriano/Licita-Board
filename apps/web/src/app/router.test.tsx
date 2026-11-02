import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { estado, logado, moduloSupabase, resetPasswordForEmail, resetarEstado, signInWithPassword } from '../test/supabaseFake'

vi.mock('../lib/supabase', () => moduloSupabase)

const { rotas } = await import('./router')
const { MENSAGEM_RECUPERACAO } = await import('../features/auth/RecuperarSenhaPage')

function abrir(caminho: string) {
  const router = createMemoryRouter(rotas, { initialEntries: [caminho] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => resetarEstado())

describe('guarda de rotas', () => {
  it('sem sessão manda para o login', async () => {
    const router = abrir('/')
    expect(await screen.findByRole('heading', { name: 'Entrar no VV Licitações' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('perfil interno sem autenticador é obrigado a cadastrar MFA', async () => {
    logado()
    estado.papeis = ['OPERADOR']
    const router = abrir('/')
    expect(await screen.findByRole('heading', { name: 'Ative a verificação em duas etapas' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa/cadastro')
  })

  it('quem tem autenticador e está em aal1 precisa digitar o código', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    estado.fatores = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    const router = abrir('/conta/sessoes')
    expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa/verificar')
  })

  it('aal2 com autenticador libera o app', async () => {
    logado()
    estado.papeis = ['ADMIN_EMPRESA']
    estado.aal = 'aal2'
    estado.fatores = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    abrir('/')
    expect(await screen.findByRole('heading', { name: /Olá, Teste/ })).toBeInTheDocument()
    expect(screen.getAllByText(/em desenvolvimento/i).length).toBeGreaterThan(0)
  })

  it('CLIENTE sem autenticador entra só com senha', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    abrir('/')
    expect(await screen.findByRole('heading', { name: /Olá/ })).toBeInTheDocument()
  })

  it('usuário liberado não fica preso na tela de MFA', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    const router = abrir('/mfa/verificar')
    await screen.findByRole('heading', { name: /Olá/ })
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('login e recuperação', () => {
  it('erro de login mostra mensagem neutra', async () => {
    signInWithPassword.mockResolvedValue({ error: { code: 'user_not_found', status: 400 } })
    abrir('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('E-mail'), 'ninguem@exemplo.com')
    await user.type(screen.getByLabelText('Senha'), 'qualquer')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.')
  })

  it('recuperação mostra a mesma mensagem mesmo se o envio falhar', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { code: 'user_not_found' } })
    abrir('/recuperar-senha')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('E-mail'), 'ninguem@exemplo.com')
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(await screen.findByText(MENSAGEM_RECUPERACAO)).toBeInTheDocument()
    expect(resetPasswordForEmail).toHaveBeenCalledWith('ninguem@exemplo.com', expect.objectContaining({ redirectTo: expect.stringContaining('/redefinir-senha') }))
  })

  it('aviso de logout por inatividade', async () => {
    abrir('/login?motivo=inatividade')
    expect(await screen.findByText(/30 minutos sem atividade/)).toBeInTheDocument()
  })
})

describe('redefinição de senha', () => {
  it('sessão comum aberta não troca a senha por /redefinir-senha (T5.3)', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    abrir('/redefinir-senha')
    expect(await screen.findByRole('heading', { name: 'Link inválido ou expirado' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument()
  })

  it('aba que veio do link do e-mail mostra o formulário', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    estado.recuperacao = true
    abrir('/redefinir-senha')
    expect(await screen.findByLabelText('Nova senha')).toBeInTheDocument()
  })

  it('quem tem autenticador confirma o código antes de trocar a senha', async () => {
    logado()
    estado.papeis = ['OPERADOR']
    estado.recuperacao = true
    estado.fatores = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    abrir('/redefinir-senha')
    expect(await screen.findByRole('heading', { name: 'Confirme o autenticador' })).toBeInTheDocument()
  })
})

describe('falhas', () => {
  it('erro ao carregar o perfil mostra tela de erro com tentar de novo', async () => {
    logado()
    estado.falharPerfil = true
    abrir('/')
    expect(await screen.findByRole('heading', { name: 'Não foi possível carregar seu acesso' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('"Sair de todos" com erro do servidor não finge sucesso', async () => {
    logado()
    estado.papeis = ['CLIENTE']
    estado.falharSignOut = true
    const router = abrir('/conta/sessoes')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sair de todos os dispositivos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível encerrar as sessões no servidor')
    expect(router.state.location.pathname).toBe('/conta/sessoes')
  })
})

describe('shell', () => {
  function liberado() {
    logado()
    estado.papeis = ['ADMIN_EMPRESA']
    estado.aal = 'aal2'
    estado.fatores = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    estado.empresas = [
      { id: 'a', razao_social: 'Alfa Comércio Ltda', nome_fantasia: 'Alfa' },
      { id: 'b', razao_social: 'Beta Equipamentos Ltda', nome_fantasia: null },
    ]
  }

  it('mostra menu principal, navegação inferior e seletor de empresa', async () => {
    liberado()
    abrir('/')
    expect(await screen.findByRole('navigation', { name: 'Menu principal' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegação inferior' })).toBeInTheDocument()
    expect(await screen.findByText(/Empresa ativa: Alfa/)).toBeInTheDocument()
  })

  it('trocar de empresa atualiza a empresa ativa e fica lembrado', async () => {
    liberado()
    abrir('/')
    const user = userEvent.setup()
    const seletores = await screen.findAllByRole('combobox')
    await user.selectOptions(seletores[0], 'b')
    expect(await screen.findByText(/Empresa ativa: Beta Equipamentos Ltda/)).toBeInTheDocument()
    expect(localStorage.getItem('vv:empresa-ativa:u1')).toBe('b')
  })

  it('sino mostra quantas notificações não lidas existem', async () => {
    liberado()
    estado.naoLidas = 3
    abrir('/')
    expect(await screen.findByRole('link', { name: 'Notificações: 3 não lidas' })).toBeInTheDocument()
  })

  it('módulo ainda não construído abre a tela EM DESENVOLVIMENTO, sem dados falsos', async () => {
    liberado()
    abrir('/agenda')
    expect(await screen.findByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
    expect(screen.getByText('EM DESENVOLVIMENTO')).toBeInTheDocument()
    expect(screen.getByText(/Fase 05/)).toBeInTheDocument()
  })
})
