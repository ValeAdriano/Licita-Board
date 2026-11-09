import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { DocumentosPosteriores } from './DocumentosPosteriores'

vi.mock('../acesso/contexto', () => ({
  useAcesso: () => ({
    pode: () => true,
  }),
}))

vi.mock('../../api/cliente', () => ({
  chamar: vi.fn(async (metodo: string, caminho: string) => {
    if (metodo === 'GET' && caminho.includes('/documentos-posteriores')) {
      return {
        linhaDoTempo: [
          {
            origem: 'registro',
            id: 'dp-1',
            tipo: 'homologacao',
            subtipo: null,
            titulo: 'Termo de homologação publicado no DOU',
            dataAto: '2026-11-08',
            numero: 'HOM-99/2026',
            participacaoId: 'part-1',
            concorrenteCnpj: null,
            observacao: 'Publicação oficial',
            link: 'https://pncp.gov.br/homologacao/99',
            documento: { id: 'doc-1', versaoId: 'ver-1', nome: 'homologacao.pdf', status: 'liberado' },
            refRota: null,
          },
          {
            origem: 'proposta',
            id: 'prop-1',
            tipo: 'proposta_final',
            subtipo: 'final',
            titulo: 'Proposta v2 (final)',
            dataAto: '2026-11-07',
            numero: 'v2',
            participacaoId: null,
            concorrenteCnpj: null,
            observacao: null,
            link: null,
            documento: null,
            refRota: '/agenda/acompanhamentos/ac-1/propostas',
          },
        ],
        grupos: { propostas: true, juridico: true, contratos: true },
        pendencias: [{ codigo: 'adjudicada_sem_documento', participacaoId: 'part-1' }],
        contratoId: 'ct-1',
      }
    }
    if (metodo === 'GET' && caminho.endsWith('/documentos')) {
      return [{ id: 'doc-1', tipoSlug: 'ata_sessao', descricao: 'Ata da sessão 01', status: 'liberado' }]
    }
    if (metodo === 'POST' && caminho.endsWith('/habilitacao-apresentada')) {
      return { gravados: 3 }
    }
    return { id: 'novo-id' }
  }),
}))

describe('DocumentosPosteriores · Bloco 9.5', () => {
  it('renderiza linha do tempo unificada, pendência informativa e desvio para contrato existente', async () => {
    render(
      <MemoryRouter>
        <DocumentosPosteriores
          empresaId="emp-1"
          acompanhamentoId="ac-1"
          itens={[
            {
              itemId: 'item-1',
              numeroItem: 1,
              descricao: 'Veículo utilitário',
              quantidade: '2',
              unidadeMedida: 'UN',
              valorEstimado: '100000',
              beneficio: 'ampla',
              retirado: false,
              participacaoId: 'part-1',
              status: 'adjudicada',
              prioridade: 'alta',
              responsavelId: null,
              situacaoDocumentacao: null,
              situacaoProposta: null,
              situacaoJuridica: null,
              atendimentoTecnico: null,
              marca: 'Marca A',
              modelo: 'Modelo B',
              versao: null,
              valorUnitario: null,
              valorTotal: null,
              pendencias: null,
              observacoes: null,
            },
          ]}
          podeEditar
          aoIrParaAcompanhamento={() => {}}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Termo de homologação publicado no DOU/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Proposta v2 \(final\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Resultado marcado como adjudicada, mas ainda sem termo de adjudicação anexado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Atualizar resultado/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Registrar habilitação apresentada/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Anexar documento/i }))
    const seletorTipo = screen.getByLabelText(/Tipo de documento/i)
    fireEvent.change(seletorTipo, { target: { value: 'contrato' } })
    expect(
      screen.getByText(/Este acompanhamento já possui contrato cadastrado\. Anexe o contrato, ata ou nota de empenho diretamente na aba Anexos do contrato/i),
    ).toBeInTheDocument()
  })
})
