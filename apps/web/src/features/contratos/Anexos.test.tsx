import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Anexos } from './Anexos'
import type { Detalhe } from './tipos'
const m = vi.hoisted(() => ({ cadastrar: true, status: 'liberado', chamar: vi.fn() }))
vi.mock('../../api/cliente', async (original) => ({ ...await original<typeof import('../../api/cliente')>(), chamar: m.chamar }))
vi.mock('../acesso/contexto', () => ({ useAcesso: () => ({ pode: (modulo: string, acao: string) => modulo === 'documentos' && (acao === 'visualizar' || m.cadastrar) }) }))
vi.mock('../../ui', async (original) => ({ ...await original<typeof import('../../ui')>(), Arquivo: ({ aoEscolher }: { aoEscolher: (f: File) => void }) => <input aria-label="Arquivo" type="file" onChange={(e) => aoEscolher(e.target.files![0]!)} /> }))
const detalhe = { contrato: { status: 'ativo' }, empenhos: [] } as unknown as Detalhe
beforeEach(() => {
  m.cadastrar = true; m.status = 'liberado'; m.chamar.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  m.chamar.mockImplementation(async (metodo: string, url: string) => {
    if (url === '/documentos/tipos') return [{ id: 'tipo', nome: 'Contrato' }]
    if (metodo === 'GET' && url.endsWith('/versoes')) return [{ id: 'versao', statusArquivo: m.status, motivoBloqueio: 'Tipo não permitido' }]
    if (metodo === 'POST' && url.endsWith('/documentos')) return { id: 'doc' }
    if (metodo === 'POST' && url.endsWith('/versoes')) return { versaoId: 'versao', url: '/envio-assinado' }
    return []
  })
})
async function enviar() {
  const u = userEvent.setup()
  render(<MemoryRouter><Anexos empresaId="empresa" id="contrato" d={detalhe} editar /></MemoryRouter>)
  await u.click(screen.getByRole('button', { name: 'Enviar arquivo' }))
  await u.selectOptions(screen.getByRole('combobox', { name: /Tipo de documento/ }), 'tipo')
  fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: [new File(['pdf'], 'anexo.pdf')] } })
  await u.click(screen.getByRole('button', { name: 'Enviar e vincular' }))
}
describe('Upload no contrato', () => {
  it('liberado vincula automaticamente após concluir o upload', async () => {
    await enviar()
    await screen.findByText('Arquivo liberado e vinculado ao contrato.')
    expect(m.chamar).toHaveBeenCalledWith('POST', '/empresas/empresa/contratos/contrato/anexos', { documentoId: 'doc', empenhoId: null, etapa: null, nota: null })
    expect(m.chamar).toHaveBeenCalledWith('POST', '/empresas/empresa/versoes/versao/concluir')
  })
  it('recusado mostra motivo e não vincula', async () => {
    m.status = 'bloqueado'; await enviar()
    await screen.findByText(/Arquivo recusado: Tipo não permitido/)
    expect(m.chamar.mock.calls.some(([metodo, url]) => metodo === 'POST' && url.endsWith('/anexos'))).toBe(false)
  })
  it('quarentena não vincula; ao liberar vincula uma única vez', async () => {
    m.status = 'quarentena'; await enviar()
    await screen.findByText(/Em quarentena:/)
    expect(m.chamar.mock.calls.some(([metodo, url]) => metodo === 'POST' && url.endsWith('/anexos'))).toBe(false)
    m.status = 'liberado'
    await screen.findByText('Arquivo liberado e vinculado ao contrato.', {}, { timeout: 3000 })
    expect(m.chamar.mock.calls.filter(([metodo, url]) => metodo === 'POST' && url.endsWith('/anexos'))).toHaveLength(1)
  })
  it('sem cadastrar esconde envio e preserva vínculo existente', async () => {
    m.cadastrar = false
    render(<MemoryRouter><Anexos empresaId="empresa" id="contrato" d={detalhe} editar /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular existente' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Enviar arquivo' })).toBeNull()
  })
})
