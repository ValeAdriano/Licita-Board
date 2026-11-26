import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArquivoTerceiro } from './ArquivoTerceiro'
import { chamar } from '../../api/cliente'
import { enviarVersao } from '../../documentos/upload'

vi.mock('../../api/cliente', () => ({ chamar: vi.fn(), ErroApi: class extends Error {} }))
vi.mock('../../documentos/upload', () => ({ enviarVersao: vi.fn(), validarArquivo: vi.fn() }))
const permissoes = { valor: true }
vi.mock('../acesso/contexto', () => ({ useAcesso: () => ({ pode: () => permissoes.valor }) }))
const api = vi.mocked(chamar)
const envio = vi.mocked(enviarVersao)

function preparar(status: string) {
  api.mockReset(); envio.mockReset()
  envio.mockResolvedValue('v1')
  api.mockImplementation(async (metodo, caminho) => {
    if (caminho === '/documentos/tipos') return [{ id: 't-rec', slug: 'recurso_terceiro_arquivo', nome: 'Recurso de terceiro' }, { id: 't-outro', slug: 'contrato_social', nome: 'Contrato social' }]
    if (metodo === 'POST' && caminho === '/empresas/e/documentos') return { id: 'doc1' }
    if (caminho === '/empresas/e/documentos/doc1/versoes') return [{ id: 'v1', statusArquivo: status, motivoBloqueio: status === 'bloqueado' ? 'antivírus: Eicar' : null }]
    throw new Error(`chamada inesperada ${metodo} ${caminho}`)
  })
}
async function escolherEEnviar(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('sem campo de arquivo')
  await act(async () => { fireEvent.change(input, { target: { files: [new File(['%PDF-1.7 recurso'], 'recurso.pdf', { type: 'application/pdf' })] } }) })
  fireEvent.click(await screen.findByRole('button', { name: 'Enviar e usar' }))
  for (let n = 0; n < 3; n++) await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
}
afterEach(() => { vi.useRealTimers(); permissoes.valor = true })

describe('ArquivoTerceiro', () => {
  it('sem permissão de cadastrar documentos, pede o texto colado', () => {
    permissoes.valor = false
    preparar('liberado')
    render(<ArquivoTerceiro empresaId="e" tipos={['recurso_terceiro_arquivo']} descricao="Recurso" rotuloBotao="Enviar e usar" aoLiberar={vi.fn()} />)
    expect(screen.getByText(/permissão de cadastrar documentos/)).toBeTruthy()
    expect(api).not.toHaveBeenCalled()
  })

  it('envia pelo repositório, espera a liberação e só então usa o arquivo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    preparar('liberado')
    const aoLiberar = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<ArquivoTerceiro empresaId="e" tipos={['recurso_terceiro_arquivo']} descricao="Recurso de X" rotuloBotao="Enviar e usar" aoLiberar={aoLiberar} />)
    await escolherEEnviar(container)
    expect(api).toHaveBeenCalledWith('POST', '/empresas/e/documentos', { tipoId: 't-rec', descricao: 'Recurso de X · recurso.pdf', semVencimento: true })
    expect(envio).toHaveBeenCalledWith('e', 'doc1', expect.any(File))
    expect(aoLiberar).toHaveBeenCalledWith('doc1')
    expect(await screen.findByText('Pronto: o texto do arquivo foi usado.')).toBeTruthy()
  })

  it('arquivo bloqueado no antivírus não é usado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    preparar('bloqueado')
    const aoLiberar = vi.fn()
    const { container } = render(<ArquivoTerceiro empresaId="e" tipos={['recurso_terceiro_arquivo']} descricao="Recurso" rotuloBotao="Enviar e usar" aoLiberar={aoLiberar} />)
    await escolherEEnviar(container)
    expect(await screen.findByText(/recusado na verificação: antivírus: Eicar/)).toBeTruthy()
    expect(aoLiberar).not.toHaveBeenCalled()
  })
})
