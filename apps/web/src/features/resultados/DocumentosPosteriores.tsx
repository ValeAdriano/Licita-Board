import { useState } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import type { ItemPart } from '../agenda/tiposAcompanhamento'
import { AreaTexto, Aviso, Botao, Campo, Cartao, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'

export interface ItemLinhaTempo {
  origem: 'registro' | 'proposta' | 'envio_proposta' | 'peca' | 'recurso_terceiro' | 'parecer' | 'contrato' | 'empenho' | 'anexo_contrato'
  id: string
  tipo: string
  subtipo: string | null
  titulo: string
  dataAto: string
  numero: string | null
  participacaoId: string | null
  concorrenteCnpj: string | null
  observacao: string | null
  link: string | null
  documento: { id: string; versaoId: string | null; nome: string; status: string | null } | null
  refRota: string | null
}

export interface RespostaDocumentosPosteriores {
  linhaDoTempo: ItemLinhaTempo[]
  grupos: { propostas: boolean | null; juridico: boolean | null; contratos: boolean | null }
  pendencias: Array<{ codigo: string; participacaoId: string }>
  contratoId: string | null
}

interface DocRepositorio {
  id: string
  tipoSlug: string
  descricao: string
  status: string
}

const ROTULO_TIPO: Record<string, string> = {
  ata_sessao: 'Ata da sessão',
  habilitacao_propria: 'Habilitação própria apresentada',
  habilitacao_vencedora: 'Habilitação da concorrente (pública)',
  decisao: 'Decisão administrativa',
  adjudicacao: 'Termo de adjudicação',
  homologacao: 'Termo de homologação',
  ata_registro_precos: 'Ata de registro de preços',
  contrato: 'Contrato assinado',
  empenho: 'Nota de empenho / OF',
  recurso_terceiro: 'Recurso de terceiro',
  contrarrazoes_terceiro: 'Contrarrazões de terceiro',
  outro: 'Outro documento pós-disputa',
  proposta_final: 'Proposta final',
  envio_proposta: 'Comprovante de envio da proposta',
  parecer: 'Parecer recursal',
  anexo_contrato: 'Anexo do contrato',
}

const ROTULO_ORIGEM: Record<string, string> = {
  registro: 'Documento posterior',
  proposta: 'Propostas',
  envio_proposta: 'Propostas',
  peca: 'Jurídico',
  recurso_terceiro: 'Jurídico',
  parecer: 'Jurídico',
  contrato: 'Contratos',
  empenho: 'Contratos',
  anexo_contrato: 'Contratos',
}

const SUBTIPOS_DECISAO: Array<{ valor: string; rotulo: string }> = [
  { valor: 'recurso', rotulo: 'Decisão de recurso' },
  { valor: 'impugnacao', rotulo: 'Decisão de impugnação' },
  { valor: 'esclarecimento', rotulo: 'Resposta a esclarecimento' },
  { valor: 'habilitacao', rotulo: 'Decisão de habilitação' },
  { valor: 'outra', rotulo: 'Outra decisão' },
]

const ROTULO_PENDENCIA: Record<string, string> = {
  homologada_sem_documento: 'Resultado marcado como homologada, mas ainda sem termo de homologação anexado.',
  adjudicada_sem_documento: 'Resultado marcado como adjudicada, mas ainda sem termo de adjudicação anexado.',
  contratada_sem_contrato: 'Resultado marcado como contratada, mas ainda sem contrato cadastrado.',
}

function formatarDia(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

export function DocumentosPosteriores({
  empresaId,
  acompanhamentoId,
  itens,
  podeEditar,
  aoIrParaAcompanhamento,
}: {
  empresaId: string
  acompanhamentoId: string
  itens: ItemPart[]
  podeEditar: boolean
  aoIrParaAcompanhamento?: () => void
}) {
  const { pode } = useAcesso()
  const veDocs = pode('documentos', 'visualizar')
  const opcoesItens = itens
    .filter((it): it is ItemPart & { participacaoId: string } => Boolean(it.participacaoId))
    .map((it) => ({
      valor: it.participacaoId,
      rotulo: `Item ${it.numeroItem} · ${it.descricao.slice(0, 50)}`,
    }))
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroPart, setFiltroPart] = useState('')
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState('ata_sessao')
  const [subtipo, setSubtipo] = useState('recurso')
  const [dataAto, setDataAto] = useState(() => new Date().toISOString().slice(0, 10))
  const [numero, setNumero] = useState('')
  const [participacaoId, setParticipacaoId] = useState('')
  const [modoFonte, setModoFonte] = useState<'link' | 'existente'>('link')
  const [link, setLink] = useState('')
  const [documentoId, setDocumentoId] = useState('')
  const [concorrenteCnpj, setConcorrenteCnpj] = useState('')
  const [observacao, setObservacao] = useState('')
  const [removendoId, setRemovendoId] = useState<string | null>(null)
  const [motivoRemocao, setMotivoRemocao] = useState('')
  const [dataHabilitacao, setDataHabilitacao] = useState(() => new Date().toISOString().slice(0, 10))
  const { enviando, erro, ok, enviar } = useEnvio()

  const qs = new URLSearchParams()
  if (filtroTipo) qs.set('tipo', filtroTipo)
  if (filtroPart) qs.set('participacao', filtroPart)
  const sufixo = qs.toString() ? `?${qs.toString()}` : ''

  const dados = useGet<RespostaDocumentosPosteriores>(
    `/empresas/${empresaId}/acompanhamentos/${acompanhamentoId}/documentos-posteriores${sufixo}`,
  )
  const docs = useGet<DocRepositorio[]>(veDocs && aberto ? `/empresas/${empresaId}/documentos` : null)

  const contratoId = dados.dados?.contratoId ?? null
  const desviarParaContrato = Boolean(contratoId && ['contrato', 'ata_registro_precos', 'empenho'].includes(tipo))
  const exigeCnpjConcorrente = ['habilitacao_vencedora', 'recurso_terceiro', 'contrarrazoes_terceiro'].includes(tipo)

  const salvar = () =>
    enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/acompanhamentos/${acompanhamentoId}/documentos-posteriores`, {
        tipo,
        subtipo: tipo === 'decisao' ? subtipo : null,
        dataAto,
        numero: numero.trim() || null,
        participacaoId: participacaoId || null,
        documentoId: modoFonte === 'existente' ? documentoId || null : null,
        link: modoFonte === 'link' ? link.trim() || null : null,
        concorrenteCnpj: exigeCnpjConcorrente && concorrenteCnpj.trim() ? concorrenteCnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase() : null,
        observacao: observacao.trim() || null,
      })
      setAberto(false)
      setNumero('')
      setLink('')
      setDocumentoId('')
      setConcorrenteCnpj('')
      setObservacao('')
      dados.recarregar()
      return 'Documento posterior registrado.'
    })

  const registrarFotoHabilitacao = () =>
    enviar(async () => {
      const r = await chamar<{ gravados: number }>(
        'POST',
        `/empresas/${empresaId}/acompanhamentos/${acompanhamentoId}/habilitacao-apresentada`,
        { dataAto: dataHabilitacao },
      )
      dados.recarregar()
      return `Foto da habilitação registrada (${r.gravados} documento(s) fixado(s)).`
    })

  const confirmarRemocao = (id: string) =>
    enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/documentos-posteriores/${id}/remover`, {
        motivo: motivoRemocao.trim(),
      })
      setRemovendoId(null)
      setMotivoRemocao('')
      dados.recarregar()
      return 'Registro removido.'
    })

  const linhaDoTempo = dados.dados?.linhaDoTempo ?? []
  const pendencias = dados.dados?.pendencias ?? []

  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? dados.erro} />
      <Aviso tipo="info" texto={ok} />

      {pendencias.map((p, idx) => (
        <Cartao key={`${p.codigo}-${p.participacaoId}-${idx}`} className="ring-1 ring-warning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-secondary">{ROTULO_PENDENCIA[p.codigo] ?? p.codigo}</span>
            {podeEditar && p.codigo !== 'contratada_sem_contrato' ? (
              <Botao
                variante="secundario"
                onClick={() => {
                  setTipo(p.codigo === 'homologada_sem_documento' ? 'homologacao' : 'adjudicacao')
                  setParticipacaoId(p.participacaoId)
                  setAberto(true)
                }}
              >
                Anexar agora
              </Botao>
            ) : null}
            {p.codigo === 'contratada_sem_contrato' ? (
              <Link to="/contratos" className="text-sm font-medium text-brand-secondary underline">
                Ir para Contratos
              </Link>
            ) : null}
          </div>
        </Cartao>
      ))}

      <Cartao>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>Documentos posteriores à disputa</h2>
            <Legenda>
              Linha do tempo unificada de atas, decisões, adjudicação, homologação, habilitação apresentada, propostas, peças jurídicas e contratos (sem duplicar arquivos).
            </Legenda>
          </div>
          {podeEditar ? (
            <div className="flex flex-wrap gap-2">
              <Botao onClick={() => setAberto((v) => !v)}>{aberto ? 'Fechar formulário' : 'Anexar documento'}</Botao>
            </div>
          ) : null}
        </div>

        {podeEditar && veDocs ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-secondary pt-3">
            <div className="w-full min-w-0 sm:w-64">
              <Campo
                rotulo="Data da apresentação da habilitação"
                type="date"
                value={dataHabilitacao}
                onChange={setDataHabilitacao}
              />
            </div>
            <Botao variante="secundario" carregando={enviando} onClick={() => void registrarFotoHabilitacao()}>
              Registrar habilitação apresentada
            </Botao>
            <Legenda className="w-full">Fixa as versões liberadas do checklist documental nesta data (não muda se o documento for renovado depois).</Legenda>
          </div>
        ) : null}

        {aberto && podeEditar ? (
          <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary p-4">
            <h3 className="text-sm font-semibold text-primary">Novo registro pós-disputa</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Selecao
                rotulo="Tipo de documento"
                value={tipo}
                onChange={setTipo}
                opcoes={[
                  { valor: 'ata_sessao', rotulo: 'Ata da sessão' },
                  { valor: 'decisao', rotulo: 'Decisão administrativa' },
                  { valor: 'adjudicacao', rotulo: 'Termo de adjudicação' },
                  { valor: 'homologacao', rotulo: 'Termo de homologação' },
                  { valor: 'ata_registro_precos', rotulo: 'Ata de registro de preços' },
                  { valor: 'contrato', rotulo: 'Contrato assinado' },
                  { valor: 'empenho', rotulo: 'Nota de empenho / OF' },
                  { valor: 'habilitacao_vencedora', rotulo: 'Habilitação da concorrente (pública)' },
                  { valor: 'recurso_terceiro', rotulo: 'Arquivo de recurso de terceiro' },
                  { valor: 'contrarrazoes_terceiro', rotulo: 'Arquivo de contrarrazões de terceiro' },
                  { valor: 'outro', rotulo: 'Outro' },
                ]}
              />
              {tipo === 'decisao' ? (
                <Selecao rotulo="Subtipo da decisão" value={subtipo} onChange={setSubtipo} opcoes={SUBTIPOS_DECISAO} />
              ) : null}
              <Campo rotulo="Data do ato" type="date" value={dataAto} onChange={setDataAto} />
              <Campo rotulo="Número / identificador (opcional)" value={numero} onChange={setNumero} maxLength={80} />
              <Selecao
                rotulo="Item (opcional)"
                value={participacaoId}
                onChange={setParticipacaoId}
                vazio="Todos os itens do acompanhamento"
                opcoes={opcoesItens}
              />
              {exigeCnpjConcorrente ? (
                <Campo
                  rotulo="CNPJ da concorrente (opcional, 14 caracteres)"
                  value={concorrenteCnpj}
                  onChange={setConcorrenteCnpj}
                  maxLength={18}
                />
              ) : null}
            </div>

            {exigeCnpjConcorrente ? (
              <Aviso
                tipo="atencao"
                texto="⚖️ LGPD: anexe somente documentos públicos disponibilizados pelo portal de compras ou pelo PNCP."
              />
            ) : null}

            {desviarParaContrato && contratoId ? (
              <Aviso
                tipo="atencao"
                texto="Este acompanhamento já possui contrato cadastrado. Anexe o contrato, ata ou nota de empenho diretamente na aba Anexos do contrato."
              />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Botao
                    variante={modoFonte === 'link' ? 'primario' : 'secundario'}
                    onClick={() => setModoFonte('link')}
                  >
                    Link público (https)
                  </Botao>
                  {veDocs ? (
                    <Botao
                      variante={modoFonte === 'existente' ? 'primario' : 'secundario'}
                      onClick={() => setModoFonte('existente')}
                    >
                      Documento do repositório
                    </Botao>
                  ) : null}
                </div>

                {modoFonte === 'link' ? (
                  <Campo
                    rotulo="Link oficial (https://...)"
                    value={link}
                    onChange={setLink}
                    maxLength={500}
                    placeholder="https://pncp.gov.br/..."
                  />
                ) : (
                  <Selecao
                    rotulo="Documento liberado no repositório"
                    value={documentoId}
                    onChange={setDocumentoId}
                    vazio="Escolha um documento"
                    opcoes={(docs.dados ?? []).map((d) => ({
                      valor: d.id,
                      rotulo: `${d.descricao} (${d.tipoSlug})`,
                    }))}
                  />
                )}

                <AreaTexto rotulo="Observação (opcional)" rows={2} value={observacao} onChange={setObservacao} maxLength={1000} />

                <div className="flex flex-wrap gap-2">
                  <Botao
                    carregando={enviando}
                    disabled={!dataAto || (modoFonte === 'link' ? !link.trim().startsWith('https://') : !documentoId)}
                    onClick={() => void salvar()}
                  >
                    Registrar documento
                  </Botao>
                </div>
              </>
            )}

            {desviarParaContrato && contratoId ? (
              <div>
                <Link to={`/contratos/${contratoId}`} className="text-sm font-medium text-brand-secondary underline">
                  Abrir contrato cadastrado →
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 border-t border-secondary pt-3 sm:grid-cols-2">
          <Selecao
            rotulo="Filtrar por tipo"
            value={filtroTipo}
            onChange={setFiltroTipo}
            vazio="Todos os tipos"
            opcoes={Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => ({ valor, rotulo }))}
          />
          <Selecao
            rotulo="Filtrar por item"
            value={filtroPart}
            onChange={setFiltroPart}
            vazio="Todos os itens"
            opcoes={opcoesItens}
          />
        </div>

        {dados.carregando ? <Legenda>Carregando linha do tempo…</Legenda> : null}
        {!dados.carregando && linhaDoTempo.length === 0 ? (
          <Vazio>Nenhum documento posterior registrado. Anexe a ata da sessão ou decisões quando saírem.</Vazio>
        ) : null}

        <div className="flex flex-col gap-3">
          {linhaDoTempo.map((item) => (
            <div key={`${item.origem}-${item.id}`} className="flex flex-col gap-2 rounded-lg border border-secondary p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-primary [overflow-wrap:anywhere]">
                    <bdi>{item.titulo}</bdi>
                  </strong>
                  <Etiqueta cor="cinza">{ROTULO_TIPO[item.tipo] ?? item.tipo}</Etiqueta>
                  {item.subtipo ? <Etiqueta cor="cinza">{item.subtipo}</Etiqueta> : null}
                  <Etiqueta cor="marca">{ROTULO_ORIGEM[item.origem] ?? item.origem}</Etiqueta>
                </div>
                <Legenda>Data do ato: {formatarDia(item.dataAto)}</Legenda>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-tertiary">
                {item.numero ? <span>Nº {item.numero}</span> : null}
                {item.concorrenteCnpj ? <span>CNPJ concorrente: {item.concorrenteCnpj}</span> : null}
                {item.observacao ? <span><bdi>{item.observacao}</bdi></span> : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {item.documento ? (
                  <span className="text-xs text-secondary">
                    Arquivo: <strong><bdi>{item.documento.nome}</bdi></strong> ({item.documento.status ?? 'liberado'})
                  </span>
                ) : null}
                {item.link ? (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-brand-secondary underline"
                  >
                    Abrir link público
                  </a>
                ) : null}
                {item.refRota ? (
                  <Link to={item.refRota} className="text-xs font-medium text-brand-secondary underline">
                    Abrir no módulo de origem
                  </Link>
                ) : null}
                {item.origem === 'registro' && (item.tipo === 'homologacao' || item.tipo === 'adjudicacao') && aoIrParaAcompanhamento ? (
                  <Botao variante="texto" onClick={aoIrParaAcompanhamento}>
                    Atualizar resultado
                  </Botao>
                ) : null}
                {item.origem === 'registro' && podeEditar ? (
                  <Botao
                    variante="texto"
                    onClick={() => {
                      setRemovendoId(removendoId === item.id ? null : item.id)
                      setMotivoRemocao('')
                    }}
                  >
                    {removendoId === item.id ? 'Cancelar remoção' : 'Remover'}
                  </Botao>
                ) : null}
              </div>

              {removendoId === item.id ? (
                <div className="flex flex-wrap items-end gap-2 border-t border-secondary pt-2">
                  <div className="w-full min-w-0 sm:min-w-64 sm:flex-1">
                    <Campo
                      rotulo="Motivo da remoção (mínimo 5 caracteres)"
                      value={motivoRemocao}
                      onChange={setMotivoRemocao}
                      maxLength={500}
                    />
                  </div>
                  <Botao
                    variante="perigo"
                    carregando={enviando}
                    disabled={motivoRemocao.trim().length < 5}
                    onClick={() => void confirmarRemocao(item.id)}
                  >
                    Confirmar remoção
                  </Botao>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Cartao>
    </div>
  )
}
