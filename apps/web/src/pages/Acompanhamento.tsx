import { Checklist } from '../features/documentos/Checklist'
import { DocumentosPosteriores } from '../features/resultados/DocumentosPosteriores'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { dataHoraSP, paraCampoLocal, paraIsoSP, PRIORIDADE, STATUS_ACOMP } from '../features/agenda/comum'
import { Eventos } from '../features/agenda/Eventos'
import { Itens } from '../features/agenda/Itens'
import { DiffVersoes } from '../features/pesquisa/DiffVersoes'
import type { Detalhe } from '../features/agenda/tiposAcompanhamento'
import { Abas, AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina, Selecao } from '../ui'

const opcoes = (m: Record<string, string>) => Object.entries(m).map(([valor, rotulo]) => ({ valor, rotulo }))

// Acompanhamento de um edital pela empresa: abertura (a data-base dos prazos), prazos, itens e histórico.
export default function Acompanhamento() {
  const { id } = useParams()
  const [busca, setBusca] = useSearchParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<Detalhe>(empresaId && id ? `/empresas/${empresaId}/acompanhamentos/${id}` : null)
  const resp = useGet<{ id: string; nome: string }[]>(empresaId ? `/empresas/${empresaId}/agenda/responsaveis` : null)
  const [recalculando, setRecalculando] = useState(false)
  if (!empresaId || !id) return null
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Acompanhamento não encontrado ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const d = det.dados
  const responsaveis = resp.dados ?? []
  const podeEditar = pode('agenda', 'editar')
  // O cálculo é do worker: depois de confirmar a abertura ou registrar um fato, relê algumas vezes até os prazos chegarem.
  const aguardarCalculo = () => {
    setRecalculando(true)
    for (const ms of [1500, 4000, 8000]) setTimeout(() => det.recarregar(), ms)
    setTimeout(() => setRecalculando(false), 8500)
  }
  const mudou = () => { det.recarregar(); aguardarCalculo() }
  return (
    <Pagina larga>
      <Link to="/agenda">← Agenda</Link>
      <CabecalhoPagina
        titulo={d.orgao}
        subtitulo={`${d.municipio ?? '—'}/${d.uf ?? '—'} · ${d.modalidade ?? '—'}${d.numeroEdital ? ` · nº ${d.numeroEdital}` : ''}${d.processo ? ` · processo ${d.processo}` : ''}`}
        acoes={
          <>
            {d.propostaEnviadaEm ? <Etiqueta cor="sucesso">Proposta enviada em {dataHoraSP(d.propostaEnviadaEm)}</Etiqueta> : null}
            {pode('propostas', 'visualizar') ? <Link to={`/agenda/acompanhamentos/${d.id}/proposta`}>Propostas</Link> : null}
            <Link to={`/editais/${d.editalId}`}>Edital e arquivos</Link>
            {d.linkOrigem ? <a href={d.linkOrigem} target="_blank" rel="noreferrer noopener">Registro oficial</a> : null}
          </>
        }
      />
      <Cartao><p className="text-sm text-secondary [overflow-wrap:anywhere]"><bdi>{d.objeto}</bdi></p></Cartao>
      <Abas
        rotulo="Seções do acompanhamento"
        ativa={
          busca.get('aba') === 'documentos' && pode('documentos', 'visualizar')
            ? 'documentos'
            : busca.get('aba') === 'pos-disputa'
              ? 'pos-disputa'
              : 'acompanhamento'
        }
        abas={[
          { id: 'acompanhamento', rotulo: 'Acompanhamento' },
          ...(pode('documentos', 'visualizar') ? [{ id: 'documentos', rotulo: 'Documentos do edital' }] : []),
          { id: 'pos-disputa', rotulo: 'Documentos posteriores' },
        ]}
        aoMudar={aba => setBusca(anterior => { const nova = new URLSearchParams(anterior); nova.set('aba', aba); return nova })}
      />
      {busca.get('aba') === 'documentos' && pode('documentos', 'visualizar') ? (
        <Checklist key={`${empresaId}/${id}`} empresaId={empresaId} acompanhamentoId={id} podeEditar={pode('documentos', 'editar')} />
      ) : busca.get('aba') === 'pos-disputa' ? (
        <DocumentosPosteriores
          key={`${empresaId}/${id}/pos`}
          empresaId={empresaId}
          acompanhamentoId={id}
          itens={d.itens}
          podeEditar={podeEditar}
          aoIrParaAcompanhamento={() => setBusca(anterior => { const nova = new URLSearchParams(anterior); nova.set('aba', 'acompanhamento'); return nova })}
        />
      ) : <>
      {d.aberturaReconfirmar ? <Aviso tipo="atencao" texto="A retificação mudou datas do edital: a abertura confirmada pode não valer mais. Reconfirme a data de abertura abaixo (os prazos calculados dependem dela)." /> : null}
      {d.editalVersaoAtual > d.editalVersaoVista ? <RetificacaoAviso empresaId={empresaId} d={d} podeEditar={podeEditar} aoMudar={mudou} /> : null}
      {recalculando ? <Aviso tipo="info" texto="Recalculando os prazos… eles aparecem em instantes." /> : null}
      {d.aberturaConfirmada ? <Eventos empresaId={empresaId} d={d} responsaveis={responsaveis} podeEditar={podeEditar} aoMudar={mudou} /> : null}
      <Abertura empresaId={empresaId} d={d} podeEditar={podeEditar} aoMudar={mudou} />
      {d.aberturaConfirmada ? null : <Eventos empresaId={empresaId} d={d} responsaveis={responsaveis} podeEditar={podeEditar} aoMudar={mudou} />}
      <Itens empresaId={empresaId} d={d} responsaveis={responsaveis} podeCadastrar={pode('agenda', 'cadastrar')} podeEditar={podeEditar} aoMudar={det.recarregar} />
      <Gestao empresaId={empresaId} d={d} responsaveis={responsaveis} podeEditar={podeEditar} aoMudar={det.recarregar} />
      </>}
    </Pagina>
  )
}

function RetificacaoAviso({ empresaId, d, podeEditar, aoMudar }: { empresaId: string; d: Detalhe; podeEditar: boolean; aoMudar: () => void }) {
  const { enviando, erro, enviar } = useEnvio()
  const [ver, setVer] = useState(false)
  return (
    <Cartao className="ring-2 ring-warning">
      <h2>Edital retificado</h2>
      <p className="text-sm text-secondary">O edital está na versão {d.editalVersaoAtual}; você conferiu a {d.editalVersaoVista}. Veja o que mudou (data, itens, quantidades, descrição) e reconfirme a abertura. Se a retificação altera a proposta, avalie a necessidade de reabrir o prazo de publicação (decisão sua: o sistema não conclui).</p>
      <Aviso texto={erro} />
      <div className="flex flex-wrap gap-3">
        <Botao variante="secundario" onClick={() => setVer(!ver)}>{ver ? 'Ocultar o que mudou' : 'Ver o que mudou'}</Botao>
        <Link to={`/editais/${d.editalId}`}>Ver as versões do edital</Link>
        {podeEditar ? <Botao variante="secundario" carregando={enviando} onClick={() => void enviar(async () => { await chamar('PATCH', `/empresas/${empresaId}/acompanhamentos/${d.id}`, { conferido: true }); aoMudar() })}>Marcar como conferido</Botao> : null}
      </div>
      {ver ? <DiffVersoes editalId={d.editalId} de={d.editalVersaoVista} para={d.editalVersaoAtual} /> : null}
    </Cartao>
  )
}

function Abertura({ empresaId, d, podeEditar, aoMudar }: { empresaId: string; d: Detalhe; podeEditar: boolean; aoMudar: () => void }) {
  const [f, setF] = useState({
    quando: paraCampoLocal(d.aberturaConfirmada ? d.dataAbertura : d.dataAbertura ?? d.encerramentoPropostasPncp), origem: d.aberturaConfirmada ? d.aberturaOrigem : 'edital',
    clausula: d.aberturaClausula ?? '', esc: paraCampoLocal(d.prazoEsclarecimentoEdital), imp: paraCampoLocal(d.prazoImpugnacaoEdital), clausulaPrazos: d.clausulaPrazos ?? '',
  })
  const { enviando, erro, enviar } = useEnvio()
  // Já confirmada: o formulário fica recolhido (os prazos vêm primeiro); a pessoa abre só se precisar corrigir a data.
  const [editando, setEditando] = useState(!d.aberturaConfirmada)
  const confirmar = () =>
    enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/acompanhamentos/${d.id}/abertura`, {
        data: paraIsoSP(f.quando), origem: f.origem, clausula: f.clausula || null,
        prazoEsclarecimento: f.esc ? paraIsoSP(f.esc) : null, prazoImpugnacao: f.imp ? paraIsoSP(f.imp) : null, clausulaPrazos: f.clausulaPrazos || null,
      })
      aoMudar()
    })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-abertura">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="h-abertura">Abertura da sessão</h2>
        {d.aberturaConfirmada ? <Etiqueta cor="sucesso">Confirmada · {d.aberturaOrigem}</Etiqueta> : <Etiqueta cor="aviso">A confirmar</Etiqueta>}
      </div>
      {!d.aberturaConfirmada ? (
        <Aviso tipo="atencao" texto={`O PNCP informa só o fim do prazo de propostas${d.encerramentoPropostasPncp ? ` (${dataHoraSP(d.encerramentoPropostasPncp)})` : ''}, não a data da sessão. Os prazos abaixo são PROVISÓRIOS até você confirmar a data no edital ou no portal.`} />
      ) : (
        <Legenda>Abertura {dataHoraSP(d.dataAbertura)} · confiabilidade {d.confiabilidade}{d.aberturaClausula ? ` · ${d.aberturaClausula}` : ''}</Legenda>
      )}
      <Aviso texto={erro} />
      {podeEditar && d.aberturaConfirmada && !editando ? <div><Botao variante="secundario" onClick={() => setEditando(true)}>Corrigir a data de abertura ou os prazos do edital</Botao></div> : null}
      {podeEditar && editando ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Data e hora da abertura (Brasília)" type="datetime-local" value={f.quando} onChange={(v) => setF({ ...f, quando: v })} />
          <Selecao rotulo="Onde você confirmou" value={f.origem} onChange={(v) => setF({ ...f, origem: v })} opcoes={[{ valor: 'edital', rotulo: 'No edital' }, { valor: 'portal', rotulo: 'No portal' }, { valor: 'manual', rotulo: 'Outra fonte' }]} />
          <Campo rotulo="Cláusula ou fonte (opcional)" value={f.clausula} onChange={(v) => setF({ ...f, clausula: v })} maxLength={300} />
          <span className="hidden sm:block" />
          <Campo rotulo="Prazo de esclarecimento fixado no edital (opcional)" type="datetime-local" value={f.esc} onChange={(v) => setF({ ...f, esc: v })} />
          <Campo rotulo="Prazo de impugnação fixado no edital (opcional)" type="datetime-local" value={f.imp} onChange={(v) => setF({ ...f, imp: v })} />
          <Campo rotulo="Cláusula dos prazos do edital" value={f.clausulaPrazos} onChange={(v) => setF({ ...f, clausulaPrazos: v })} maxLength={300} />
        </div>
      ) : null}
      {podeEditar && editando ? <div><Botao carregando={enviando} disabled={!f.quando} onClick={() => void confirmar()}>{d.aberturaConfirmada ? 'Atualizar abertura e recalcular' : 'Confirmar abertura e calcular prazos'}</Botao></div> : null}
    </section>
  )
}

function Gestao({ empresaId, d, responsaveis, podeEditar, aoMudar }: { empresaId: string; d: Detalhe; responsaveis: { id: string; nome: string }[]; podeEditar: boolean; aoMudar: () => void }) {
  const [f, setF] = useState({ status: d.status, prioridade: d.prioridade, responsavelId: d.responsavelId ?? '', portal: d.portal ?? '', linkDisputa: d.linkDisputa ?? '', linkDocumentos: d.linkDocumentos ?? '', observacoes: d.observacoes ?? '' })
  const { enviando, erro, ok, enviar } = useEnvio()
  const salvar = () =>
    enviar(async () => {
      await chamar('PATCH', `/empresas/${empresaId}/acompanhamentos/${d.id}`, {
        status: f.status, prioridade: f.prioridade, responsavelId: f.responsavelId || null, portal: f.portal || null,
        linkDisputa: f.linkDisputa || null, linkDocumentos: f.linkDocumentos || null, observacoes: f.observacoes || null,
      })
      aoMudar()
      return 'Salvo.'
    })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-gestao">
      <h2 id="h-gestao">Gestão do acompanhamento</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Selecao rotulo="Situação" value={f.status} onChange={(v) => setF({ ...f, status: v })} disabled={!podeEditar} opcoes={opcoes(STATUS_ACOMP)} />
        <Selecao rotulo="Prioridade" value={f.prioridade} onChange={(v) => setF({ ...f, prioridade: v })} disabled={!podeEditar} opcoes={opcoes(PRIORIDADE)} />
        <Selecao rotulo="Responsável" value={f.responsavelId} onChange={(v) => setF({ ...f, responsavelId: v })} disabled={!podeEditar} vazio="Sem responsável" opcoes={responsaveis.map((r) => ({ valor: r.id, rotulo: r.nome }))} />
        <Campo rotulo="Portal" value={f.portal} onChange={(v) => setF({ ...f, portal: v })} disabled={!podeEditar} maxLength={120} />
        <Campo rotulo="Link da disputa (https)" value={f.linkDisputa} onChange={(v) => setF({ ...f, linkDisputa: v })} disabled={!podeEditar} maxLength={500} />
        <Campo rotulo="Link dos documentos (https)" value={f.linkDocumentos} onChange={(v) => setF({ ...f, linkDocumentos: v })} disabled={!podeEditar} maxLength={500} />
      </div>
      <AreaTexto rotulo="Observações" rows={3} value={f.observacoes} onChange={(v) => setF({ ...f, observacoes: v })} disabled={!podeEditar} maxLength={4000} />
      <Legenda>Última conferência do edital: {dataHoraSP(d.ultimaConferenciaEm)}</Legenda>
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {podeEditar ? <div><Botao carregando={enviando} onClick={() => void salvar()}>Salvar</Botao></div> : null}
    </section>
  )
}
