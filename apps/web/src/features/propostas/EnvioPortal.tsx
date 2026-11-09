import { useEffect, useRef, useState } from 'react'
import { chamar } from '../../api/cliente'
import { enviarVersao, validarArquivo } from '../../documentos/upload'
import { AreaTexto, Arquivo, Aviso, Botao, Campo, Etiqueta, Legenda, Selecao } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'
import { dataHoraSP, paraCampoLocal, paraIsoSP } from '../agenda/comum'

export interface EnvioResumo {
  id: string
  enviadoEm: string
  formato: 'docx' | 'pdf' | 'outro'
  portal: string | null
  identificadorPortal: string | null
  registradoEm: string
}

export interface PropostaEnvio {
  id: string
  propostaVersao: number
  formato: 'docx' | 'pdf' | 'outro'
  propostaSha256: string | null
  enviadoEm: string
  portal: string | null
  identificadorPortal: string | null
  tipoComprovante: string | null
  representanteId: string | null
  representante: string | null
  comprovante: { documentoId: string; versaoId: string; nome: string; status: string } | null
  observacao: string | null
  registradoEm: string
  registradoPor: { nome: string | null }
  anulado: { em: string; por: string | null; motivo: string } | null
  avisos: string[]
}

interface TipoDoc { id: string; slug: string; nome: string }
interface DocRepo { id: string; tipoId: string; descricao: string; status: string; versaoAtualId: string | null }
interface VersaoDoc { id: string; statusArquivo: string; motivoBloqueio: string | null }

const AVISOS_ROTULO: Record<string, string> = {
  envio_apos_encerramento: 'Envio informado após o encerramento das propostas ou abertura da sessão.',
  versao_nao_ultima_final: 'Esta versão não é a última proposta final do acompanhamento.',
  comprovante_nao_liberado: 'Comprovante pendente ou bloqueado na verificação.',
}

const FORMATOS = [
  { valor: 'pdf', rotulo: 'PDF (.pdf)' },
  { valor: 'docx', rotulo: 'Word (.docx)' },
  { valor: 'outro', rotulo: 'Outro formato' },
]

export function EnvioPortal({
  empresaId,
  propostaId,
  versao,
  portalPadrao,
  representantePadrao,
  representantes,
  podeAprovar,
  aoMudar,
}: {
  empresaId: string
  propostaId: string
  versao: number
  portalPadrao: string | null
  representantePadrao: string | null
  representantes: { id: string; nome: string }[]
  podeAprovar: boolean
  aoMudar: () => void
}) {
  const enviosReq = useGet<{ envios: PropostaEnvio[] }>(`/empresas/${empresaId}/propostas/${propostaId}/envios`)
  const tipos = useGet<TipoDoc[]>(podeAprovar ? '/documentos/tipos' : null)
  const docs = useGet<DocRepo[]>(podeAprovar ? `/empresas/${empresaId}/documentos` : null)

  const [enviadoEm, setEnviadoEm] = useState(() => paraCampoLocal(new Date().toISOString()))
  const [formato, setFormato] = useState<'docx' | 'pdf' | 'outro'>('pdf')
  const [portal, setPortal] = useState(portalPadrao ?? '')
  const [identificador, setIdentificador] = useState('')
  const [tipoComprovante, setTipoComprovante] = useState('')
  const [representanteId, setRepresentanteId] = useState(representantePadrao ?? '')
  const [documentoId, setDocumentoId] = useState('')
  const [observacao, setObservacao] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [statusUpload, setStatusUpload] = useState<string | null>(null)
  const [erroUpload, setErroUpload] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)

  const [anulandoId, setAnulandoId] = useState<string | null>(null)
  const [motivoAnulacao, setMotivoAnulacao] = useState('')
  const reg = useEnvio()
  const anul = useEnvio()
  const dl = useEnvio()
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false }
  }, [])

  const tipoComprovanteDoc = (tipos.dados ?? []).find((t) => t.slug === 'comprovante_envio_proposta')
  const comprovantesLiberados = (docs.dados ?? []).filter(
    (d) => tipoComprovanteDoc && d.tipoId === tipoComprovanteDoc.id && d.versaoAtualId !== null,
  )

  const enviarArquivoComprovante = async () => {
    if (!arquivo || !tipoComprovanteDoc) return
    setErroUpload(null)
    setVerificando(true)
    try {
      validarArquivo(arquivo)
      setStatusUpload('Criando comprovante no repositório e enviando arquivo…')
      const doc = await chamar<{ id: string }>('POST', `/empresas/${empresaId}/documentos`, {
        tipoId: tipoComprovanteDoc.id,
        descricao: `Comprovante proposta v${String(versao)} - ${arquivo.name}`.slice(0, 300),
        semVencimento: true,
      })
      const versaoId = await enviarVersao(empresaId, doc.id, arquivo, '', '')
      let espera = 1500
      for (let tentativa = 0; vivo.current && tentativa < 30; tentativa++) {
        setStatusUpload('Em quarentena: verificando antivírus, tipo real e SHA-256…')
        await new Promise((r) => setTimeout(r, espera))
        espera = Math.min(espera * 2, 8000)
        const versoes = await chamar<VersaoDoc[]>('GET', `/empresas/${empresaId}/documentos/${doc.id}/versoes`, undefined, { fundo: true })
        const v = versoes.find((x) => x.id === versaoId)
        if (v?.statusArquivo === 'bloqueado') {
          setErroUpload(`Comprovante recusado na verificação: ${v.motivoBloqueio ?? 'arquivo bloqueado'}.`)
          setStatusUpload(null)
          setVerificando(false)
          return
        }
        if (v?.statusArquivo === 'liberado') {
          setDocumentoId(doc.id)
          setArquivo(null)
          setStatusUpload('Comprovante verificado e liberado para registro.')
          setVerificando(false)
          docs.recarregar()
          return
        }
      }
      if (vivo.current) {
        setStatusUpload('A verificação continua em andamento no repositório de Documentos. Atualize em instantes.')
        setVerificando(false)
      }
    } catch (e) {
      if (vivo.current) {
        setErroUpload(e instanceof Error ? e.message : 'Falha ao enviar o comprovante.')
        setStatusUpload(null)
        setVerificando(false)
      }
    }
  }

  const registrar = () =>
    reg.enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/propostas/${propostaId}/envios`, {
        enviadoEm: paraIsoSP(enviadoEm),
        formato,
        portal: portal.trim() || null,
        identificadorPortal: identificador.trim() || null,
        tipoComprovante: tipoComprovante.trim() || null,
        representanteId: representanteId || null,
        documentoId,
        observacao: observacao.trim() || null,
      })
      setIdentificador('')
      setObservacao('')
      setStatusUpload(null)
      enviosReq.recarregar()
      aoMudar()
    })

  const envios = enviosReq.dados?.envios ?? []

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-secondary p-4 ring-1 ring-secondary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-primary">Envio ao portal (v{versao})</h3>
        {envios.some((e) => !e.anulado) ? (
          <Etiqueta cor="sucesso">Proposta cadastrada no portal</Etiqueta>
        ) : (
          <Etiqueta cor="cinza">Sem envio ativo</Etiqueta>
        )}
      </div>
      <p className="text-sm text-secondary">
        O sistema não envia propostas. Envie no portal e registre aqui o comprovante.
      </p>

      {envios.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label={`Histórico de envios da versão ${versao}`}>
          {envios.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded-lg bg-primary p-3 text-sm ring-1 ring-secondary">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={e.anulado ? 'line-through text-tertiary' : 'font-medium text-primary'}>
                  Enviado em {dataHoraSP(e.enviadoEm)} · {e.formato.toUpperCase()}
                  {e.portal ? ` · ${e.portal}` : ''}
                  {e.identificadorPortal ? ` · protocolo/recibo ${e.identificadorPortal}` : ''}
                  {e.tipoComprovante ? ` (${e.tipoComprovante})` : ''}
                </span>
                {e.anulado ? <Etiqueta cor="erro">Anulado</Etiqueta> : <Etiqueta cor="sucesso">Registrado</Etiqueta>}
              </div>
              <Legenda>
                Registrado por {e.registradoPor.nome ?? '—'} em {dataHoraSP(e.registradoEm)}
                {e.representante ? ` · representante ${e.representante}` : ''}
                {e.propostaSha256 ? ` · SHA-256 ${e.propostaSha256.slice(0, 16)}…` : ''}
              </Legenda>
              {e.observacao ? <p className="text-secondary [overflow-wrap:anywhere]"><bdi>{e.observacao}</bdi></p> : null}
              {e.avisos.length > 0 ? (
                <ul className="list-disc pl-5 text-warning-primary">
                  {e.avisos.map((c) => <li key={c}>{AVISOS_ROTULO[c] ?? c}</li>)}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {e.comprovante ? (
                  <Botao
                    variante="secundario"
                    carregando={dl.enviando}
                    onClick={() => void dl.enviar(async () => {
                      const r = await chamar<{ url: string }>('POST', `/empresas/${empresaId}/versoes/${e.comprovante!.versaoId}/download`)
                      window.location.assign(r.url)
                    })}
                  >
                    Baixar comprovante ({e.comprovante.nome})
                  </Botao>
                ) : (
                  <Legenda>Arquivo do comprovante restrito (requer permissão de visualização de documentos).</Legenda>
                )}
                {!e.anulado && podeAprovar && anulandoId !== e.id ? (
                  <Botao variante="texto" onClick={() => { setAnulandoId(e.id); setMotivoAnulacao('') }}>
                    Anular envio
                  </Botao>
                ) : null}
              </div>
              {e.anulado ? (
                <p className="text-xs text-error-primary [overflow-wrap:anywhere]">
                  Anulado em {dataHoraSP(e.anulado.em)}{e.anulado.por ? ` por ${e.anulado.por}` : ''}: <bdi>{e.anulado.motivo}</bdi>
                </p>
              ) : null}
              {anulandoId === e.id && podeAprovar ? (
                <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
                  <Aviso texto={anul.erro} />
                  <Campo
                    rotulo="Motivo da anulação (mínimo 10 caracteres)"
                    value={motivoAnulacao}
                    onChange={setMotivoAnulacao}
                    maxLength={1000}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Botao
                      variante="perigo"
                      carregando={anul.enviando}
                      disabled={motivoAnulacao.trim().length < 10}
                      onClick={() => void anul.enviar(async () => {
                        await chamar('POST', `/empresas/${empresaId}/proposta-envios/${e.id}/anular`, { motivo: motivoAnulacao.trim() })
                        setAnulandoId(null)
                        setMotivoAnulacao('')
                        enviosReq.recarregar()
                        aoMudar()
                      })}
                    >
                      Confirmar anulação
                    </Botao>
                    <Botao variante="texto" onClick={() => setAnulandoId(null)}>Cancelar</Botao>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {podeAprovar ? (
        <div className="flex flex-col gap-3 rounded-lg bg-primary p-4 ring-1 ring-secondary">
          <h4 className="text-sm font-medium text-primary">Registrar comprovante de envio</h4>
          <Aviso texto={reg.erro ?? erroUpload ?? dl.erro} />
          {statusUpload ? <Aviso tipo="info" texto={statusUpload} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Arquivo
              rotulo="1. Enviar novo arquivo de comprovante (até 25 MB)"
              arquivo={arquivo}
              aoEscolher={setArquivo}
              aceita={['.pdf', '.png', '.jpg', '.jpeg', '.docx']}
            />
            <div className="flex items-end">
              <Botao
                variante="secundario"
                carregando={verificando}
                disabled={!arquivo || !tipoComprovanteDoc}
                onClick={() => void enviarArquivoComprovante()}
              >
                Enviar e verificar comprovante
              </Botao>
            </div>
            <Selecao
              rotulo="Comprovante verificado e liberado"
              value={documentoId}
              onChange={setDocumentoId}
              vazio="Selecione um comprovante liberado"
              opcoes={comprovantesLiberados.map((c) => ({ valor: c.id, rotulo: c.descricao }))}
            />
            <Campo
              rotulo="Data e hora do envio (Brasília)"
              type="datetime-local"
              value={enviadoEm}
              onChange={setEnviadoEm}
            />
            <Selecao
              rotulo="Formato enviado ao portal"
              value={formato}
              onChange={(v) => setFormato(v as 'docx' | 'pdf' | 'outro')}
              opcoes={FORMATOS}
            />
            <Campo
              rotulo="Portal"
              value={portal}
              onChange={setPortal}
              maxLength={120}
            />
            <Campo
              rotulo="Identificador/protocolo no portal (opcional)"
              value={identificador}
              onChange={setIdentificador}
              maxLength={120}
            />
            <Campo
              rotulo="Tipo de comprovante (ex: recibo, protocolo, tela)"
              value={tipoComprovante}
              onChange={setTipoComprovante}
              maxLength={120}
            />
            <Selecao
              rotulo="Representante (informativo)"
              value={representanteId}
              onChange={setRepresentanteId}
              vazio="Mesmo da proposta"
              opcoes={representantes.map((r) => ({ valor: r.id, rotulo: r.nome }))}
            />
          </div>
          <AreaTexto
            rotulo="Observação (opcional)"
            rows={2}
            value={observacao}
            onChange={setObservacao}
            maxLength={1000}
          />
          <div>
            <Botao
              carregando={reg.enviando}
              disabled={!documentoId || !enviadoEm || verificando}
              onClick={() => void registrar()}
            >
              Registrar envio
            </Botao>
          </div>
        </div>
      ) : null}
    </div>
  )
}
