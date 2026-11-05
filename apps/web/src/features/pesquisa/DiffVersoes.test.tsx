import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiffVersoes } from './DiffVersoes'

const dados = {
  de: 1, para: 2, alteraProposta: true,
  campos: [{ campo: 'valor_estimado', rotulo: 'Valor estimado', formato: 'dinheiro', antes: '1000.0000', depois: '1500.5000' }],
  itens: [{ numeroItem: 3, descricao: 'Mesa de reunião', tipo: 'alterado', mudancas: [{ campo: 'quantidade', rotulo: 'Quantidade', formato: 'texto', antes: '10.0000', depois: '12.0000' }] }],
  arquivos: [{ titulo: 'Retificação 1', tipo: 'anexo', url: 'https://x/2', situacao: 'novo' }],
}
vi.mock('../acesso/useGet', () => ({ useGet: () => ({ dados, erro: null, carregando: false }) }))

describe('DiffVersoes', () => {
  it('mostra antes e depois, o item alterado, o arquivo novo e o aviso de proposta', () => {
    render(<DiffVersoes editalId="e1" de={1} para={2} />)
    expect(screen.getByText('Mudanças da versão 1 para a 2')).toBeInTheDocument()
    expect(screen.getByText('R$ 1.000,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 1.500,50')).toBeInTheDocument()
    expect(screen.getByText('Item alterado')).toBeInTheDocument()
    expect(screen.getByText('10.0000')).toBeInTheDocument()
    expect(screen.getByText('Arquivo novo')).toBeInTheDocument()
    expect(screen.getByText(/altera o conteúdo da proposta/)).toBeInTheDocument()
  })
})
