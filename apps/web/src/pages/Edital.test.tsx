import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { chamar } from '../api/cliente'
import PaginaEdital from './Edital'

vi.mock('../api/cliente', () => ({ chamar: vi.fn() }))
vi.mock('../features/acesso/contexto', () => ({ useAcesso: () => ({ empresa: null, pode: () => false }) }))

function arquivo(id: string, titulo: string, extra = {}) {
  return { id, titulo, tipo: 'anexo', urlOrigem: 'https://exemplo.com/anexo', statusArquivo: 'liberado', motivo: null, tamanho: null, paginas: null, statusExtracao: 'pendente', arquivoPaiId: null, statusCompactado: null, motivoCompactado: null, ...extra }
}

describe('Arquivos do edital', () => {
  it('agrupa filhos mesmo fora de ordem e distingue compactados de arquivo comum', async () => {
    vi.mocked(chamar).mockImplementation(async (_metodo, caminho) => {
      if (caminho === '/pesquisa/estado') return []
      if (caminho === '/editais/e1') return {
        id: 'e1', orgao: 'Órgão fictício', objeto: 'Compra fictícia', versaoAtual: 1,
        itens: [], versoes: [], arquivos: [
          arquivo('filho1', 'edital.pdf', { arquivoPaiId: 'zip' }),
          arquivo('comum', 'aviso.pdf'),
          arquivo('zip', 'anexos.zip', { statusCompactado: 'extraido' }),
          arquivo('filho2', 'planilha.xlsx', { arquivoPaiId: 'zip' }),
          arquivo('senha', 'restrito.zip', { statusCompactado: 'pendente', motivoCompactado: 'Protegido por senha' }),
          arquivo('bomba', 'inseguro.zip', { statusCompactado: 'recusado', motivoCompactado: 'Possível bomba de ZIP' }),
        ],
      }
      throw new Error(`Rota inesperada: ${caminho}`)
    })
    render(<MemoryRouter initialEntries={['/editais/e1']}><Routes><Route path="/editais/:id" element={<PaginaEdital />} /></Routes></MemoryRouter>)
    const filhos = await screen.findByRole('list', { name: 'Arquivos dentro de anexos.zip' })
    expect(within(filhos).getAllByRole('listitem')).toHaveLength(2)
    expect(within(filhos).getByText('edital.pdf')).toBeInTheDocument()
    expect(within(filhos).getByText('planilha.xlsx')).toBeInTheDocument()
    expect(within(filhos).getAllByText(/Dentro de/)).toHaveLength(2)
    const grupo = filhos.parentElement!
    expect(within(grupo).getByText('Compactado: extraído')).toBeInTheDocument()
    for (const [titulo, status, motivo] of [
      ['restrito.zip', 'pendente', 'Protegido por senha'],
      ['inseguro.zip', 'recusado', 'Possível bomba de ZIP'],
    ]) {
      const cartao = screen.getByText(titulo).closest('li')!
      expect(within(cartao).getByText(`Compactado: ${status}`)).toBeInTheDocument()
      expect(within(cartao).getByText(motivo)).toBeInTheDocument()
    }
    const comum = screen.getByText('aviso.pdf').closest('li')!
    expect(within(comum).queryByText(/Compactado:|Dentro de/)).not.toBeInTheDocument()
    expect(within(comum).getByRole('button', { name: 'Baixar' })).toBeInTheDocument()
  })
})
