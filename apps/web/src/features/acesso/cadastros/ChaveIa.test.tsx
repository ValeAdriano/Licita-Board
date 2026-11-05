import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChaveIa } from './ChaveIa'

let dados: Record<string, unknown> = { configurada: false, ultimos4: null, modelo: null, testeStatus: null, testeErro: null, testeEm: null, atualizadaEm: null, modelosDisponiveis: ['claude-sonnet-5-5', 'claude-opus-5-5'], modeloPadrao: 'claude-sonnet-5-5' }
vi.mock('../useGet', () => ({ useGet: () => ({ dados, erro: null, carregando: false, recarregar: () => {} }) }))
vi.mock('../contexto', () => ({ useAcesso: () => ({ pode: () => true }) }))

describe('Chave de IA', () => {
  it('sem chave: avisa que a IA está desligada e só habilita salvar com o formato certo; o campo é de senha', async () => {
    render(<ChaveIa empresaId="e1" />)
    expect(screen.getByText(/Nenhuma chave cadastrada/)).toBeInTheDocument()
    const campo = screen.getByLabelText(/Chave da API/)
    expect(campo).toHaveAttribute('type', 'password')
    const salvar = screen.getByRole('button', { name: 'Salvar chave' })
    expect(salvar).toBeDisabled()
    await userEvent.setup().type(campo, 'chave-errada')
    expect(salvar).toBeDisabled()
    await userEvent.setup().clear(campo)
    await userEvent.setup().type(campo, 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX')
    expect(salvar).toBeEnabled()
  })
  it('com chave: mostra só os 4 últimos caracteres e o resultado do teste, nunca a chave', () => {
    dados = { ...dados, configurada: true, ultimos4: 'wxyz', testeStatus: 'falhou', testeErro: 'o provedor respondeu 401' }
    render(<ChaveIa empresaId="e1" />)
    expect(screen.getByText(/termina em wxyz/)).toBeInTheDocument()
    expect(screen.getByText(/Teste falhou: o provedor respondeu 401/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Testar a chave' })).toBeInTheDocument()
    expect(screen.getByText('Trocar a chave')).toBeInTheDocument()
  })
})
