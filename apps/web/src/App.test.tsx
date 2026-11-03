import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Rotas } from './App'
import type { Fase } from './auth/sessao'

const mocks = vi.hoisted(() => ({ fase: 'anonimo' as Fase }))
vi.mock('./auth/sessao', () => ({ useSessao: () => ({ fase: mocks.fase, recarregar: vi.fn() }) }))
// Telas reais precisam de provedores e rede: aqui só importa quem aparece em cada fase.
vi.mock('./pages/Layout', async () => {
  const { Outlet } = await import('react-router')
  return { default: () => <div>shell<Outlet /></div> }
})
vi.mock('./pages/Entrar', () => ({ default: () => <p>tela-entrar</p> }))
vi.mock('./pages/Recuperar', () => ({ default: () => <p>tela-recuperar</p> }))
vi.mock('./pages/RedefinirSenha', () => ({ default: () => <p>tela-redefinir</p> }))
vi.mock('./pages/Mfa', () => ({ default: () => <p>tela-mfa</p> }))
vi.mock('./pages/Inicio', () => ({ default: () => <p>tela-inicio</p> }))
vi.mock('./pages/Notificacoes', () => ({ default: () => <p>tela-notificacoes</p> }))
vi.mock('./pages/Equipe', () => ({ default: () => <p>tela-equipe</p> }))
vi.mock('./pages/Conta', () => ({ default: () => <p>tela-conta</p> }))

function em(fase: Fase, caminho: string) {
  mocks.fase = fase
  render(
    <MemoryRouter initialEntries={[caminho]}>
      <Rotas />
    </MemoryRouter>,
  )
}

// Cada conjunto de telas só existe na fase certa da sessão (a API confere de novo em toda chamada).
describe('Rotas por fase da sessão', () => {
  it('sem sessão, qualquer endereço do app cai no login', () => {
    for (const caminho of ['/', '/equipe', '/conta', '/mfa', '/qualquer-coisa']) {
      em('anonimo', caminho)
      expect(screen.getByText('tela-entrar')).toBeInTheDocument()
      expect(screen.queryByText('shell')).toBeNull()
      document.body.innerHTML = ''
    }
  })

  it('sem sessão, recuperação e redefinição de senha abrem', () => {
    em('anonimo', '/recuperar')
    expect(screen.getByText('tela-recuperar')).toBeInTheDocument()
  })

  it('com senha só (aal1) em perfil interno, só o MFA abre', () => {
    for (const caminho of ['/', '/equipe', '/entrar']) {
      em('mfa', caminho)
      expect(screen.getByText('tela-mfa')).toBeInTheDocument()
      expect(screen.queryByText('shell')).toBeNull()
      document.body.innerHTML = ''
    }
  })

  it('com sessão ativa o app abre e login/MFA voltam para o início', () => {
    em('ativa', '/equipe')
    expect(screen.getByText('shell')).toBeInTheDocument()
    expect(screen.getByText('tela-equipe')).toBeInTheDocument()
    document.body.innerHTML = ''
    em('ativa', '/entrar')
    expect(screen.getByText('tela-inicio')).toBeInTheDocument()
  })

  it('carregando e sem conexão não mostram nenhuma tela de dados', () => {
    em('carregando', '/equipe')
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeInTheDocument()
    document.body.innerHTML = ''
    em('sem_conexao', '/equipe')
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument()
    expect(screen.queryByText('tela-equipe')).toBeNull()
  })
})
