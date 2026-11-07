import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Checklist, type Exigencia, type Resultado } from './Checklist'
import { chamar } from '../../api/cliente'
vi.mock('../../api/cliente', () => ({ chamar: vi.fn(), ErroApi: class extends Error {} }))
const api = vi.mocked(chamar)
const item = (situacao: string | null, id = '1'): Exigencia => ({ id, tipoId: id, tipoNome: `Tipo ${id}`, aplicavel: true, conferenciaManual: false, regularidadeFiscal: false, observacao: null, situacao, documentoId: null, validade: '2026-11-06', diasParaVencer: -1, aviso: null, recalculando: false })
function preparar(itens: Exigencia[]) {
  api.mockReset()
  api.mockImplementation(async (_metodo, caminho) => caminho === '/documentos/tipos' ? [{ id: 'tipo', nome: 'Certidão', pasta: 'fiscal_trabalhista' }] : { dataSessao: '2026-11-08', sessaoConfirmada: false, itens } as Resultado)
}
afterEach(() => vi.useRealTimers())
describe('Checklist documental', () => {
  it('mostra as seis situações, validade negativa e aviso da API, sem edição', async () => {
    preparar(['valido', 'vencido', 'vence_antes_da_sessao', 'ausente', 'nao_aplicavel', 'depende_conferencia'].map((s, i) => ({ ...item(s, String(i)), aviso: i === 0 ? 'Texto vindo da API' : null })))
    render(<Checklist empresaId="e" acompanhamentoId="a" podeEditar={false} />)
    for (const texto of ['Válido', 'Vencido', 'Vence antes da sessão', 'Ausente', 'Não aplicável', 'Depende de conferência']) expect((await screen.findAllByText(texto)).length).toBeGreaterThan(0)
    expect(screen.getByText('Texto vindo da API')).toBeTruthy()
    expect(screen.getAllByText(/-1 dias para vencer/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Adicionar exigência' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recalcular agora' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
  })
  it('adiciona exigência pelo contrato e mostra sucesso', async () => {
    preparar([])
    render(<Checklist empresaId="e" acompanhamentoId="a" podeEditar />)
    await screen.findByText('Nenhuma exigência cadastrada')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar exigência' }))
    fireEvent.change(screen.getByRole('combobox', { name: /Tipo de documento/ }), { target: { value: 'tipo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar exigência' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/empresas/e/acompanhamentos/a/checklist/exigencias', { tipoId: 'tipo', aplicavel: true, conferenciaManual: false, regularidadeFiscal: true, observacao: null }))
    expect(await screen.findByText('Exigência salva.')).toBeTruthy()
  })
  it('relê enquanto recalcula e limita a cinco tentativas', async () => {
    vi.useFakeTimers()
    preparar([{ ...item(null), recalculando: true }])
    render(<Checklist empresaId="e" acompanhamentoId="a" podeEditar={false} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getAllByText('Calculando…').length).toBeGreaterThan(0)
    for (let n = 0; n < 10; n++) await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(api).toHaveBeenCalledTimes(6)
  })
  it('para de reler quando termina o cálculo', async () => {
    vi.useFakeTimers()
    preparar([item('valido')])
    api.mockResolvedValueOnce({ dataSessao: null, sessaoConfirmada: null, itens: [{ ...item(null), recalculando: true }] })
    render(<Checklist empresaId="e" acompanhamentoId="a" podeEditar={false} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(api).toHaveBeenCalledTimes(2)
  })
})
