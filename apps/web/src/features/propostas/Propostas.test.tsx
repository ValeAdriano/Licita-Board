import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Propostas, type DadosPropostas } from './Propostas'

vi.mock('../../api/cliente', () => ({
  chamar: vi.fn(async (metodo: string, caminho: string) => {
    if (metodo === 'GET' && caminho.endsWith('/envios')) {
      return {
        envios: [
          {
            id: 'env-1',
            propostaVersao: 1,
            formato: 'pdf',
            propostaSha256: 'b'.repeat(64),
            enviadoEm: '2026-11-08T14:00:00-03:00',
            portal: 'Compras.gov.br',
            identificadorPortal: 'REC-2026-99',
            tipoComprovante: 'recibo_portal',
            representanteId: null,
            representante: null,
            comprovante: { documentoId: 'doc-1', versaoId: 'ver-1', nome: 'recibo.pdf', status: 'liberado' },
            observacao: 'Protocolado pela equipe',
            registradoEm: '2026-11-08T14:05:00-03:00',
            registradoPor: { nome: 'Operador Teste' },
            anulado: null,
            avisos: ['envio_apos_encerramento'],
          },
        ],
      }
    }
    if (metodo === 'GET' && caminho === '/documentos/tipos') {
      return [{ id: 'tipo-comp', slug: 'comprovante_envio_proposta', nome: 'Comprovante de envio de proposta' }]
    }
    if (metodo === 'GET' && caminho.endsWith('/documentos')) {
      return [{ id: 'doc-1', tipoId: 'tipo-comp', descricao: 'Comprovante Compras.gov', status: 'valido', versaoAtualId: 'ver-1' }]
    }
    return {}
  }),
}))

const dadosBase: DadosPropostas = {
  portal: 'Compras.gov.br',
  representantes: [{ id: 'rep-1', nome: 'Representante 1', tipo: 'socio' }],
  propostas: [
    {
      id: 'prop-1',
      versao: 1,
      tipo: 'inicial',
      status: 'final',
      representanteId: 'rep-1',
      representante: 'Representante 1',
      validadeDias: 60,
      prazoEntregaDias: 30,
      garantiaMeses: 12,
      condicoes: null,
      local: 'Curitiba',
      conteudo: [{ numero_item: 1, descricao: 'Notebook', quantidade: '10', valor_unitario: '3500', valor_total: '35000', marca: 'Marca A', modelo: 'M1', casas: 2 }],
      total: '35000.0000',
      totalExtenso: 'trinta e cinco mil reais',
      validacao: [],
      validadaEm: '2026-11-08T12:00:00-03:00',
      bloqueada: false,
      arquivoSha256: 'a'.repeat(64),
      geradoEm: '2026-11-08T12:05:00-03:00',
      temArquivo: true,
      temPdf: true,
      conferidoPor: 'Conferente',
      conferidoEm: '2026-11-08T12:01:00-03:00',
      aprovadoPor: 'Aprovador',
      aprovadoEm: '2026-11-08T12:04:00-03:00',
      ultimoEnvio: {
        id: 'env-1',
        enviadoEm: '2026-11-08T14:00:00-03:00',
        formato: 'pdf',
        portal: 'Compras.gov.br',
        identificadorPortal: 'REC-2026-99',
        registradoEm: '2026-11-08T14:05:00-03:00',
      },
    },
  ],
}

describe('Propostas · Bloco 8.7 (Envio ao portal)', () => {
  it('exibe histórico de envios, avisos não bloqueantes e formulário para quem pode aprovar', async () => {
    render(
      <Propostas
        empresaId="emp-1"
        acompanhamentoId="ac-1"
        d={dadosBase}
        podeCadastrar
        podeEditar
        podeAprovar
        aoMudar={() => {}}
      />,
    )

    expect(screen.getByText(/O sistema não envia propostas/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/REC-2026-99/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Envio informado após o encerramento das propostas/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Baixar comprovante \(recibo\.pdf\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Registrar envio/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anular envio/i })).toBeInTheDocument()
  })

  it('oculta formulário de registro e botão de anulação quando não tem permissão propostas/aprovar', async () => {
    render(
      <Propostas
        empresaId="emp-1"
        acompanhamentoId="ac-1"
        d={dadosBase}
        podeCadastrar={false}
        podeEditar={false}
        podeAprovar={false}
        aoMudar={() => {}}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/REC-2026-99/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Registrar envio/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Anular envio/i })).not.toBeInTheDocument()
  })
})
