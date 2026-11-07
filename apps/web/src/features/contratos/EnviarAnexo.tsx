import { useEffect, useRef, useState } from 'react'
import { chamar } from '../../api/cliente'
import { enviarVersao, validarArquivo } from '../../documentos/upload'
import { Arquivo, Aviso, Botao, Campo, Selecao } from '../../ui'
import { useGet } from '../acesso/useGet'

interface Versao { id: string; statusArquivo: string; motivoBloqueio: string | null }
export function EnviarAnexo({ empresaId, base, destino, aoVincular }: {
  empresaId: string; base: string; destino: { empenhoId: string | null; etapa: string | null; nota: string | null }; aoVincular: () => void
}) {
  const tipos = useGet<{ id: string; nome: string }[]>('/documentos/tipos')
  const [tipo, setTipo] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [validade, setValidade] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [pendente, setPendente] = useState<{ doc: string; versao: string; destino: typeof destino } | null>(null)
  const vivo = useRef(true)
  const trava = useRef(false)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => {
    if (!pendente) return
    let ativo = true
    let timer: ReturnType<typeof setTimeout>
    const verificar = async () => {
      try {
        const lista = await chamar<Versao[]>('GET', `/empresas/${empresaId}/documentos/${pendente.doc}/versoes`, undefined, { fundo: true })
        if (!ativo) return
        const v = lista.find((x) => x.id === pendente.versao)
        if (v?.statusArquivo === 'bloqueado') {
          setMsg(`Arquivo recusado: ${v.motivoBloqueio ?? 'não passou na verificação'}. Não foi vinculado.`)
          setPendente(null); setOcupado(false); trava.current = false
        } else if (v?.statusArquivo === 'liberado') {
          setMsg('Arquivo liberado. Vinculando…')
          await chamar('POST', `${base}/anexos`, { documentoId: pendente.doc, ...pendente.destino })
          if (!ativo) return
          setMsg('Arquivo liberado e vinculado ao contrato.'); setPendente(null); setOcupado(false); trava.current = false
          aoVincular()
        } else {
          setMsg('Em quarentena: verificando antivírus, tipo real e hash. Mantenha esta aba aberta para vincular automaticamente.')
          timer = setTimeout(() => void verificar(), 1500)
        }
      } catch (e) {
        if (ativo) { setErro(e instanceof Error ? e.message : 'Falha ao verificar ou vincular.'); setOcupado(false); trava.current = false }
      }
    }
    void verificar()
    return () => { ativo = false; clearTimeout(timer) }
  }, [pendente, empresaId, base, aoVincular])
  const enviar = async () => {
    if (trava.current) return
    trava.current = true; setOcupado(true); setErro(null)
    try {
      validarArquivo(arquivo)
      setMsg('Criando documento e enviando arquivo…')
      const doc = await chamar<{ id: string }>('POST', `/empresas/${empresaId}/documentos`, { tipoId: tipo, descricao: `Anexo ${arquivo.name}`.slice(0, 300), semVencimento: false })
      const versao = await enviarVersao(empresaId, doc.id, arquivo, '', validade)
      if (vivo.current) setPendente({ doc: doc.id, versao, destino: { ...destino } })
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
    {pendente && !ocupado ? <Botao onClick={() => { setErro(null); setOcupado(true); setPendente({ ...pendente }) }}>Tentar verificar e vincular novamente</Botao> : null}
  </div>
}
