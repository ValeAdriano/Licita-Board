import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Alertas } from './Alertas'

const mocks = vi.hoisted(() => ({ estado: vi.fn(), ativar: vi.fn(), desativar: vi.fn() }))
vi.mock('../../../push/push', () => ({ estadoPush: mocks.estado, ativarPush: mocks.ativar, desativarPush: mocks.desativar }))

beforeEach(() => {
  mocks.estado.mockReset()
  mocks.ativar.mockReset().mockResolvedValue(undefined)
  mocks.desativar.mockReset().mockResolvedValue(undefined)
})

describe('Alertas neste dispositivo', () => {
  it('desligado: explica que o aviso não mostra conteúdo e só liga por clique', async () => {
    mocks.estado.mockResolvedValueOnce('desligado').mockResolvedValueOnce('ligado')
    render(<Alertas />)
    await waitFor(() => expect(screen.getByText(/não mostra o conteúdo/)).toBeInTheDocument())
    expect(mocks.ativar).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ligar alertas' }))
    expect(mocks.ativar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText(/Alertas ligados neste dispositivo\. Sair da conta/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Desligar alertas' })).toBeInTheDocument()
  })

  it('ligado: desliga', async () => {
    mocks.estado.mockResolvedValueOnce('ligado').mockResolvedValueOnce('desligado')
    render(<Alertas />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Desligar alertas' }))
    expect(mocks.desativar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ligar alertas' })).toBeInTheDocument())
  })

  it('mostra o motivo quando não dá para ligar (iPhone sem instalar, bloqueado, desligado no servidor)', async () => {
    for (const [estado, texto] of [
      ['instalar', /instale o app na tela inicial/],
      ['negado', /bloqueadas neste navegador/],
      ['indisponivel', /ainda não estão ativos/],
    ] as const) {
      mocks.estado.mockResolvedValueOnce(estado)
      const { unmount } = render(<Alertas />)
      await waitFor(() => expect(screen.getByText(texto)).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Ligar alertas' })).toBeNull()
      unmount()
    }
  })

  it('erro ao ligar aparece e o estado não muda', async () => {
    mocks.estado.mockResolvedValue('desligado')
    mocks.ativar.mockRejectedValue(new Error('Permissão para notificações negada.'))
    render(<Alertas />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ligar alertas' }))
    // useEnvio só mostra ErroApi; erro genérico vira mensagem segura
    await waitFor(() => expect(screen.getByText('Algo deu errado. Tente de novo.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Ligar alertas' })).toBeInTheDocument()
  })
})
