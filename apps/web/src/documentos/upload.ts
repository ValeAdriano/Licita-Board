import { chamar, ErroApi } from '../api/cliente'

export function validarArquivo(arquivo: File | null): asserts arquivo is File {
  if (!arquivo || arquivo.size === 0) throw new ErroApi(400, 'Escolha um arquivo não vazio.')
  if (arquivo.size > 25 * 1024 * 1024) throw new ErroApi(400, 'O arquivo passa de 25 MB.')
}

// Mesmo protocolo da Fase 03: URL assinada, quarentena e verificação pelo worker.
export async function enviarVersao(empresaId: string, documentoId: string, arquivo: File, emissao = '', validade = '') {
  validarArquivo(arquivo)
  const v = await chamar<{ versaoId: string; url: string }>('POST', `/empresas/${empresaId}/documentos/${documentoId}/versoes`, { nome: arquivo.name, tamanho: arquivo.size, emissao: emissao || null, validade: validade || null })
  const put = await fetch(v.url, { method: 'PUT', body: arquivo })
  if (!put.ok) throw new ErroApi(502, 'Falha ao enviar o arquivo.')
  await chamar('POST', `/empresas/${empresaId}/versoes/${v.versaoId}/concluir`)
  return v.versaoId
}
