import { useEffect, useRef, useState } from 'react'
import { chamar } from '../../api/cliente'
import { enviarVersao, validarArquivo } from '../../documentos/upload'
import { Arquivo, Aviso, Botao, Campo, Selecao } from '../../ui'
import { useGet } from '../acesso/useGet'

interface Versao { id: string; statusArquivo: string; motivoBloqueio: string | null }
interface Pendencia { doc: string; versao: string; destino: { empenhoId: string | null; etapa: string | null; nota: string | null } }
const LIMITE_VERIFICACAO_MS = 180_000
const ESPERA_INICIAL_MS = 1_500
const ESPERA_MAXIMA_MS = 10_000

function lerPendencia(chave: string): Pendencia | null {
  try {
    const valor: unknown = JSON.parse(sessionStorage.getItem(chave) ?? 'null')
    if (!valor || typeof valor !== 'object') return null
    const p = valor as Partial<Pendencia>
    if (typeof p.doc !== 'string' || typeof p.versao !== 'string' || !p.destino || typeof p.destino !== 'object') return null
    const d = p.destino as Partial<Pendencia['destino']>
    if (!(d.empenhoId === null || typeof d.empenhoId === 'string') || !(d.etapa === null || typeof d.etapa === 'string') || !(d.nota === null || typeof d.nota === 'string')) return null
    return { doc: p.doc, versao: p.versao, destino: { empenhoId: d.empenhoId, etapa: d.etapa, nota: d.nota } }
  } catch { return null }
}

export function EnviarAnexo({ empresaId, base, destino, aoVincular }: {
  empresaId: string; base: string; destino: { empenhoId: string | null; etapa: string | null; nota: string | null }; aoVincular: () => void
}) {
  const tipos = useGet<{ id: string; nome: string }[]>('/documentos/tipos')
  const [tipo, setTipo] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [validade, setValidade] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const chavePendencia = `vv.contrato.anexo.pendente:${empresaId}:${base.split('/').at(-1)}`
  const [ocupado, setOcupado] = useState(() => lerPendencia(chavePendencia) !== null)
  const [pendente, setPendente] = useState<Pendencia | null>(() => lerPendencia(chavePendencia))
  const [retentativa, setRetentativa] = useState(0)
  const vivo = useRef(true)
  const trava = useRef(false)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => {
    if (!pendente) return
    sessionStorage.setItem(chavePendencia, JSON.stringify(pendente))
    let ativo = true
    let timer: ReturnType<typeof setTimeout>
    const inicio = Date.now()
    let espera = ESPERA_INICIAL_MS
    const verificar = async () => {
      try {
        const lista = await chamar<Versao[]>('GET', `/empresas/${empresaId}/documentos/${pendente.doc}/versoes`, undefined, { fundo: true })
        if (!ativo) return
        const v = lista.find((x) => x.id === pendente.versao)
        if (v?.statusArquivo === 'bloqueado') {
          setMsg(`Arquivo recusado: ${v.motivoBloqueio ?? 'não passou na verificação'}. Não foi vinculado.`)
          sessionStorage.removeItem(chavePendencia); setPendente(null); setOcupado(false); trava.current = false
        } else if (v?.statusArquivo === 'liberado') {
          setMsg('Arquivo liberado. Vinculando…')
          await chamar('POST', `${base}/anexos`, { documentoId: pendente.doc, ...pendente.destino })
          if (!ativo) return
          sessionStorage.removeItem(chavePendencia); setMsg('Arquivo liberado e vinculado ao contrato.'); setPendente(null); setOcupado(false); trava.current = false
          aoVincular()
        } else if (Date.now() - inicio >= LIMITE_VERIFICACAO_MS) {
          setMsg('A verificação está demorando. O arquivo continua no repositório de Documentos; tente verificar e vincular de novo em instantes.')
          setOcupado(false)
        } else {
          setMsg('Em quarentena: verificando antivírus, tipo real e hash. Você pode fechar esta aba; a verificação será retomada ao voltar.')
          timer = setTimeout(() => void verificar(), espera)
          espera = Math.min(espera * 2, ESPERA_MAXIMA_MS)
        }
      } catch (e) {
        if (ativo) { setErro(e instanceof Error ? e.message : 'Falha ao verificar ou vincular.'); setOcupado(false); trava.current = false }
      }
    }
    void verificar()
    return () => { ativo = false; clearTimeout(timer) }
  }, [pendente, empresaId, base, aoVincular, chavePendencia, retentativa])
  const enviar = async () => {
    if (trava.current) return
    trava.current = true; setOcupado(true); setErro(null)
    try {
      validarArquivo(arquivo)
      setMsg('Criando documento e enviando arquivo…')
      const doc = await chamar<{ id: string }>('POST', `/empresas/${empresaId}/documentos`, { tipoId: tipo, descricao: `Anexo ${arquivo.name}`.slice(0, 300), semVencimento: false })
      const versao = await enviarVersao(empresaId, doc.id, arquivo, '', validade)
      if (vivo.current) {
        const nova = { doc: doc.id, versao, destino: { ...destino } }
        sessionStorage.setItem(chavePendencia, JSON.stringify(nova))
        setPendente(nova)
      }
    } catch (e) {
      if (vivo.current) { setErro(e instanceof Error ? e.message : 'Falha ao enviar.'); setMsg('O arquivo não foi vinculado. Confira o repositório de Documentos antes de reenviar.'); setOcupado(false) }
      trava.current = false
    }
  }
  return <div className="flex min-w-0 flex-col gap-3">
    <Aviso texto={erro ?? tipos.erro} />
    <Selecao rotulo="Tipo de documento" value={tipo} onChange={setTipo} disabled={ocupado || !!pendente} vazio="Escolha" opcoes={(tipos.dados ?? []).map((t) => ({ valor: t.id, rotulo: t.nome }))} />
    <Arquivo rotulo="Arquivo (até 25 MB)" arquivo={arquivo} aoEscolher={setArquivo} aceita={['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.odt', '.doc', '.xls']} />
    <Campo rotulo="Validade do documento (opcional)" type="date" value={validade} onChange={setValidade} disabled={ocupado} />
    <p role="status" className="text-sm text-secondary [overflow-wrap:anywhere]">{tipos.carregando ? 'Carregando tipos…' : msg}</p>
    <Botao carregando={ocupado} disabled={!tipo || !arquivo || !!pendente} onClick={() => void enviar()}>Enviar e vincular</Botao>
    {pendente && !ocupado ? <><Botao onClick={() => { setErro(null); setOcupado(true); setRetentativa((n) => n + 1) }}>Tentar verificar e vincular novamente</Botao><Botao variante="texto" onClick={() => { sessionStorage.removeItem(chavePendencia); setPendente(null); setMsg('Pendência descartada. O arquivo continua no repositório de Documentos.'); setOcupado(false); trava.current = false }}>Descartar pendência</Botao></> : null}
  </div>
}
