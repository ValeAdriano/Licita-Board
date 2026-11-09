import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComparativoAlternativas, Matriz } from './Matriz'
import { exigido, type Analise, type Dados } from './tipos'

const dados: Dados = {
  participacao: { id: 'p1', status: 'avaliando', numeroItem: 1, descricao: 'Veículo', quantidade: '1', unidadeMedida: 'UN', acompanhamentoId: 'a1', orgao: 'Órgão', numeroEdital: '1/2026' },
  requisitos: [
    { id: 'r1', nome: 'Potência', tipo: 'minimo', atributoId: null, operador: '>=', valorNumero: '100.500000000000', valorMax: null, valorTexto: null, unidadeId: 'u1', obrigatorio: true, citacaoEdital: 'potência mínima', pagina: 4, origem: 'manual' },
    { id: 'r2', nome: 'Torque', tipo: 'minimo', atributoId: null, operador: '>=', valorNumero: '350', valorMax: null, valorTexto: null, unidadeId: null, obrigatorio: false, citacaoEdital: null, pagina: null, origem: 'manual' },
  ],
  analises: [], produtos: [], atributos: [], unidades: [{ id: 'u1', simbolo: 'kW', grandeza: 'potencia' }],
}
const analise: Analise = {
  id: 'an1', produtoId: 'pr1', codigoInterno: 'P-1', marca: 'Fiat', modelo: 'Strada', descricao: 'x', resumo: 'PENDENTE', calculadoEm: '2026-11-05T12:00:00Z', aprovadoEm: null, aprovadoResumo: null, aprovadoPor: null,
  linhas: [{ id: 'l1', analiseId: 'an1', requisitoId: 'r1', resultado: 'A CONFIRMAR', valorOferecido: '105 kW', citacaoVerificada: true, paginaEdital: 4, fichaTrecho: null, fichaPagina: null, fichaDocumentoId: null, fichaConferidaEm: null, fichaConferidaPor: null, ressalva: null, justificativa: null, pendencia: 'Falta conferir a evidência na ficha técnica oficial.' }],
}

describe('Matriz da análise técnica', () => {
  it('mostra o resultado calculado, a evidência do edital e o que falta na ficha; sem aprovar com pendência', () => {
    render(<Matriz empresaId="e1" d={dados} a={analise} podeEditar podeAprovar aoMudar={() => {}} />)
    expect(screen.getByText('PENDENTE')).toBeInTheDocument()
    expect(screen.getByText('A CONFIRMAR')).toBeInTheDocument()
    expect(screen.getByText('Aguardando')).toBeInTheDocument() // o requisito opcional ainda sem linha
    expect(screen.getByText(/Produto oferece: 105 kW/)).toBeInTheDocument()
    expect(screen.getByText(/citação conferida, página 4/)).toBeInTheDocument()
    expect(screen.getByText('falta conferir')).toBeInTheDocument()
    expect(screen.getByText(/Pendência: Falta conferir/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprovar análise técnica' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Conferir ficha técnica' })).toBeInTheDocument()
  })
  it('formata o que o edital exige sem zeros à direita', () => {
    expect(exigido(dados.requisitos[0]!, dados.unidades)).toBe('no mínimo 100.5 kW')
    expect(exigido({ ...dados.requisitos[0]!, operador: 'entre', valorMax: '120.000000000000' }, dados.unidades)).toBe('entre 100.5 kW e 120 kW')
    expect(exigido({ ...dados.requisitos[0]!, operador: 'sim' }, dados.unidades)).toBe('tem (sim)')
  })
  it('exibe verificação automática do texto da ficha privada e comparativo de alternativas (6.4)', () => {
    const a1: Analise = {
      ...analise,
      id: 'an-ok',
      resumo: 'COMPATÍVEL',
      posicaoAlternativa: 1,
      rotuloAlternativa: 'melhor_compativel',
      disponibilidade: 'imediata',
      prazoEntregaDias: 15,
      precoCusto: '85000.0000',
      riscosCount: 0,
      pendenciasCount: 0,
      linhas: [{ ...analise.linhas[0]!, resultado: 'ATENDE', fichaConferidaPor: 'Ana', fichaCitacaoVerificada: true, pendencia: null }],
    }
    const a2: Analise = {
      ...analise,
      id: 'an-2',
      codigoInterno: 'P-2',
      marca: 'VW',
      modelo: 'Saveiro',
      resumo: 'COMPATÍVEL COM RESSALVAS',
      posicaoAlternativa: 2,
      rotuloAlternativa: 'segunda_alternativa',
      disponibilidade: 'sob_encomenda',
      riscosCount: 1,
      pendenciasCount: 0,
    }
    render(
      <>
        <ComparativoAlternativas analises={[a1, a2]} />
        <Matriz empresaId="e1" d={dados} a={a1} podeEditar podeAprovar aoMudar={() => {}} />
      </>,
    )
    expect(screen.getAllByText('1ª opção · Melhor compatível').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('2ª alternativa')).toBeInTheDocument()
    expect(screen.getByText('texto da ficha verificado')).toBeInTheDocument()
    expect(screen.getByText(/Disponibilidade imediata/)).toBeInTheDocument()
    expect(screen.getByText(/Custo: R\$ 85\.000,00/)).toBeInTheDocument()
  })
})
