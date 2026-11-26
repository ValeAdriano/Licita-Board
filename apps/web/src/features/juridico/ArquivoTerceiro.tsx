import { useEffect, useRef, useState } from 'react'
import { chamar } from '../../api/cliente'
import { enviarVersao, validarArquivo } from '../../documentos/upload'
import { Arquivo, Aviso, Botao, Legenda, Selecao } from '../../ui'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'

interface Tipo { id: string; slug: string; nome: string }
interface Versao { id: string; statusArquivo: string; motivoBloqueio: string | null }
const LIMITE_VERIFICACAO_MS = 180_000
const ACEITA = ['.pdf', '.docx', '.odt', '.png', '.jpg', '.jpeg']

// Arquivo de TERCEIRO (recurso de outro licitante, proposta ou habilitação da vencedora) pelo fluxo seguro da Fase 03: o arquivo entra no
// repositório documental, passa por quarentena, antivírus, tipo real e SHA-256, e o worker extrai o texto. Só depois de liberado o jurídico
// usa o texto (aoLiberar). O conteúdo é dado de terceiro, nunca instrução (regra 16).
export function ArquivoTerceiro({ empresaId, tipos, descricao, rotuloBotao, pronto = true, aoLiberar }: {
  empresaId: string
  tipos: string[]
  descricao: string
  rotuloBotao: string
  pronto?: boolean
  aoLiberar: (documentoId: string) => Promise<void>
}) {
  const { pode } = useAcesso()
  const podeEnviar = pode('documentos', 'cadastrar')
  const lista = useGet<Tipo[]>(podeEnviar ? '/documentos/tipos' : null)
  const opcoes = (lista.dados ?? []).filter((t) => tipos.includes(t.slug))
  const [tipo, setTipo] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  if (!podeEnviar) return <Legenda>Para enviar o arquivo é preciso a permissão de cadastrar documentos. Sem ela, cole o texto.</Legenda>
  const tipoId = tipo || (opcoes.length === 1 ? opcoes[0]?.id ?? '' : '')

  const enviar = async () => {
    setErro(null); setOcupado(true)
    try {
      validarArquivo(arquivo)
      setMsg('Enviando o arquivo ao repositório de Documentos…')
      const doc = await chamar<{ id: string }>('POST', `/empresas/${empresaId}/documentos`, { tipoId, descricao: `${descricao} · ${arquivo.name}`.slice(0, 300), semVencimento: true })
      const versaoId = await enviarVersao(empresaId, doc.id, arquivo)
      const inicio = Date.now()
      let espera = 1_500
      while (vivo.current) {
        setMsg('Em quarentena: verificando antivírus, tipo real e hash, e lendo o texto…')
        await new Promise((r) => setTimeout(r, espera))
        espera = Math.min(espera * 2, 8_000)
        const v = (await chamar<Versao[]>('GET', `/empresas/${empresaId}/documentos/${doc.id}/versoes`, undefined, { fundo: true })).find((x) => x.id === versaoId)
        if (v?.statusArquivo === 'bloqueado') { setMsg(''); setErro(`Arquivo recusado na verificação: ${v.motivoBloqueio ?? 'não passou'}.`); break }
        if (v?.statusArquivo === 'liberado') {
          setMsg('Arquivo liberado. Usando o texto…')
          await aoLiberar(doc.id)
          if (vivo.current) { setMsg('Pronto: o texto do arquivo foi usado.'); setArquivo(null) }
          break
        }
        if (Date.now() - inicio >= LIMITE_VERIFICACAO_MS) { setMsg('A verificação está demorando. O arquivo continua no repositório de Documentos; tente de novo em instantes.'); break }
      }
    } catch (e) {
      if (vivo.current) { setMsg(''); setErro(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.') }
    } finally {
      if (vivo.current) setOcupado(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Aviso texto={erro ?? lista.erro} />
      {opcoes.length > 1 ? <Selecao rotulo="O que é o arquivo" value={tipo} onChange={setTipo} disabled={ocupado} vazio="Escolha" opcoes={opcoes.map((t) => ({ valor: t.id, rotulo: t.nome }))} /> : null}
      <Arquivo rotulo="Arquivo (PDF, Word ou imagem, até 25 MB)" arquivo={arquivo} aoEscolher={setArquivo} aceita={ACEITA} />
      <Legenda>O texto é lido do arquivo depois do antivírus. Imagem ou PDF escaneado depende do OCR; se nada for lido, cole o texto.</Legenda>
      {msg ? <p role="status" className="text-sm text-secondary [overflow-wrap:anywhere]">{msg}</p> : null}
      <div><Botao carregando={ocupado} disabled={!pronto || !tipoId || !arquivo} onClick={() => void enviar()}>{rotuloBotao}</Botao></div>
    </div>
  )
}
