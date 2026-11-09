import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { useReautenticacao } from '../features/acesso/useReautenticacao'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { dataHoraSP } from '../features/agenda/comum'
import { TesesDaPeca } from '../features/juridico/TesesDaPeca'
import { MinutaIa } from '../features/juridico/MinutaIa'
import { RESULTADO_PECA, STATUS_PECA, TIPO_PECA, type Peca } from '../features/juridico/tipos'
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina, Selecao } from '../ui'

// Uma peça: minuta com a conferência de citações, fluxo de revisão e aprovação, documento final, protocolo humano e resultado.
export default function PecaPagina() {
  const { id } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<Peca>(empresaId && id ? `/empresas/${empresaId}/juridico/pecas/${id}` : null)
  if (!empresaId || !id) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Peça não encontrada ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  return <Conteudo key={det.dados.status + (det.dados.validadaEm ?? '')} empresaId={empresaId} p={det.dados} pode={pode} recarregar={det.recarregar} />
}

function Conteudo({ empresaId, p, pode, recarregar }: { empresaId: string; p: Peca; pode: (m: string, a: string) => boolean; recarregar: () => void }) {
  const { enviando, erro, enviar } = useEnvio()
  const [minuta, setMinuta] = useState(p.minuta ?? '')
  const [clausulas, setClausulas] = useState(p.clausulas ?? '')
  const [just, setJust] = useState('')
  const [prot, setProt] = useState({ numero: '', quando: '', comprovante: '' })
  const [res, setRes] = useState({ resultado: 'deferido', obs: '' })
  const reaut = useReautenticacao('aprovar_peca', 'Aprovar a peça libera o documento final para protocolo. Confirme com o código do autenticador.', [`Aprovar: ${p.titulo}`])
  const [rotulo, cor] = STATUS_PECA[p.status] ?? [p.status, 'cinza' as const]
  const base = `/empresas/${empresaId}/juridico/pecas/${p.id}`
  const editavel = ['triagem', 'minuta', 'revisao'].includes(p.status) && pode('juridico', 'elaborar_peca')
  const acao = (caminho: string, texto: string, v: 'primario' | 'secundario' | 'texto' = 'secundario', off = false) => (
    <Botao variante={v} carregando={enviando} disabled={off} onClick={() => void enviar(async () => { await chamar('POST', `${base}/${caminho}`); recarregar() })}>{texto}</Botao>
  )
  const bloqueios = (p.validacao ?? []).filter((x) => x.bloqueia)
  const avisos = (p.validacao ?? []).filter((x) => !x.bloqueia)
  const baixar = (formato: 'docx' | 'pdf') => enviar(async () => { const r = await chamar<{ url: string }>('POST', `${base}/download`, { formato }); window.location.assign(r.url) })
  return (
    <Pagina larga>
      <Link to="/juridico">← Jurídico</Link>
      <CabecalhoPagina titulo={p.titulo} subtitulo={`${TIPO_PECA[p.tipo] ?? p.tipo} · ${p.orgao ?? ''}${p.numeroEdital ? ` · edital nº ${p.numeroEdital}` : ''}`} acoes={<Etiqueta cor={cor}>{rotulo}</Etiqueta>} />
      <Aviso texto={erro} />
      {p.prazoLegal ? <Aviso tipo="atencao" texto={`Prazo legal na agenda: ${dataHoraSP(p.prazoLegal)}${p.prazoInterno ? ` (data interna ${dataHoraSP(p.prazoInterno)})` : ''}. ⚖️ A regra do prazo ainda não foi validada pelo jurídico: confira o edital.`} /> : null}
      {p.recursoId ? <Link to={`/juridico/recursos/${p.recursoId}`}>Ver o recurso de terceiro e as alegações →</Link> : null}
      {['triagem', 'minuta'].includes(p.status) && pode('juridico', 'elaborar_peca') ? <MinutaIa empresaId={empresaId} pecaId={p.id} temMinuta={(p.minuta ?? '').trim().length > 0} aoConcluir={recarregar} /> : null}
      {editavel && ['triagem', 'minuta', 'revisao'].includes(p.status) ? <TesesDaPeca empresaId={empresaId} pecaId={p.id} aoInserir={(t) => setMinuta((m) => (m.trim() ? `${m.trimEnd()}\n\n${t}` : t))} /> : null}
      <Cartao>
        <h2>Minuta{p.minutaOrigem === 'ia' ? <> <Etiqueta cor="aviso">Rascunho da IA: revise</Etiqueta></> : p.minutaOrigem === 'ia_revisada' ? <> <Etiqueta cor="cinza">Nasceu de rascunho da IA, revisado</Etiqueta></> : null}</h2>
        <Legenda>Cite apenas fontes da base jurídica VERIFICADA. O sistema confere cada citação (lei, artigo, acórdão, súmula, Constituição) ao salvar e bloqueia a minuta se alguma não estiver na base. Separe os parágrafos com uma linha em branco.</Legenda>
        <AreaTexto rotulo="Texto da peça" value={minuta} onChange={setMinuta} rows={16} maxLength={60000} disabled={!editavel} />
        <Campo rotulo="Cláusulas, documentos e páginas do edital que sustentam os argumentos" value={clausulas} onChange={setClausulas} maxLength={2000} disabled={!editavel} />
        {p.status !== 'triagem' || p.validadaEm ? (p.validadaEm === null ? <Aviso tipo="info" texto="Conferindo as citações… atualize em instantes." /> : bloqueios.length ? (
          <div role="alert" className="flex flex-col gap-1 rounded-xl border border-error bg-error-primary p-3 text-sm text-error-primary"><strong>Bloqueios ({bloqueios.length})</strong><ul className="list-disc pl-5">{bloqueios.map((b) => <li key={b.codigo + b.mensagem} className="[overflow-wrap:anywhere]">{b.mensagem}</li>)}</ul></div>
        ) : <Etiqueta cor="sucesso">Citações conferidas na base verificada</Etiqueta>) : null}
        {avisos.length ? <ul className="list-disc pl-5 text-sm text-warning-primary">{avisos.map((b) => <li key={b.codigo}>{b.mensagem}</li>)}</ul> : null}
        {editavel ? <div className="flex flex-wrap gap-3">
          <Botao carregando={enviando} disabled={minuta.trim().length < 5} onClick={() => void enviar(async () => { await chamar('PUT', `${base}/minuta`, { minuta, clausulas: clausulas.trim() || null }); recarregar() })}>Salvar e conferir citações</Botao>
          {p.status === 'minuta' ? acao('revisao', 'Enviar para revisão jurídica', 'primario', p.bloqueada || p.validadaEm === null) : null}
        </div> : null}
        {p.status === 'minuta' && pode('juridico', 'elaborar_peca') ? (
          <div className="flex flex-wrap items-end gap-3"><div className="w-full min-w-0 sm:min-w-64 sm:flex-1"><Campo rotulo="Descartar a peça (justificativa obrigatória)" value={just} onChange={setJust} maxLength={1000} /></div>
            <Botao variante="texto" carregando={enviando} disabled={just.trim().length < 10} onClick={() => void enviar(async () => { await chamar('POST', `${base}/descartar`, { justificativa: just.trim() }); recarregar() })}>Descartar</Botao></div>
        ) : null}
        {p.justificativaDescarte ? <Legenda>Descartada: <bdi>{p.justificativaDescarte}</bdi></Legenda> : null}
      </Cartao>
      {['revisao', 'aprovada'].includes(p.status) && pode('juridico', 'aprovar_peca') ? (
        <Cartao><h2>Revisão e aprovação jurídica</h2><Legenda>Só quem tem permissão de aprovar peças aprova. Aprovada, o sistema gera o documento final com hash e o trava.</Legenda>
          <div className="flex flex-wrap gap-3">{p.status === 'revisao' ? <><Botao carregando={enviando} disabled={p.bloqueada} onClick={() => void enviar(async () => { await reaut.executar(async (stepUp) => { await chamar('POST', `${base}/aprovar`, { stepUp }); recarregar() }) })}>Aprovar e gerar documento final</Botao>{reaut.modal}</> : null}{acao('devolver', 'Devolver a minuta', 'texto')}</div></Cartao>
      ) : null}
      {['final', 'protocolada', 'respondida'].includes(p.status) ? (
        <Cartao>
          <h2>Documento final</h2>
          {p.arquivoSha256 ? <Legenda>Gerado em {dataHoraSP(p.geradoEm)} · SHA-256 {p.arquivoSha256}{p.aprovadoPor ? ` · aprovada por ${p.aprovadoPor}` : ''}</Legenda> : null}
          <div className="flex flex-wrap gap-3">
            {p.temArquivo ? <Botao carregando={enviando} onClick={() => void baixar('docx')}>Baixar Word (.docx)</Botao> : null}
            {p.temPdf ? <Botao carregando={enviando} onClick={() => void baixar('pdf')}>Baixar PDF</Botao> : acao('pdf', 'Gerar PDF')}
          </div>
        </Cartao>
      ) : null}
      {p.status === 'final' && pode('juridico', 'elaborar_peca') ? (
        <Cartao><h2>Registrar o protocolo</h2><Legenda>O sistema NUNCA protocola. Protocole no portal você mesmo e registre aqui o número, a data e hora e o comprovante.</Legenda>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Campo rotulo="Número do protocolo" value={prot.numero} onChange={(v) => setProt({ ...prot, numero: v })} maxLength={80} /><Campo rotulo="Data e hora (Brasília)" type="datetime-local" value={prot.quando} onChange={(v) => setProt({ ...prot, quando: v })} /><Campo rotulo="Comprovante (observação ou link)" value={prot.comprovante} onChange={(v) => setProt({ ...prot, comprovante: v })} maxLength={1000} /></div>
          <div><Botao carregando={enviando} disabled={prot.numero.trim().length < 2 || !prot.quando} onClick={() => void enviar(async () => { await chamar('POST', `${base}/protocolo`, { numero: prot.numero.trim(), quando: `${prot.quando.slice(0, 16)}:00-03:00`, comprovante: prot.comprovante.trim() || null }); recarregar() })}>Registrar protocolo</Botao></div></Cartao>
      ) : null}
      {['protocolada', 'respondida'].includes(p.status) ? <Cartao><h2>Protocolo e resultado</h2><Legenda>Protocolo {p.protocoloNumero} em {dataHoraSP(p.protocoladoEm)}{p.comprovante ? ` · ${p.comprovante}` : ''}</Legenda>
        {p.resultado ? <Etiqueta cor={p.resultado === 'indeferido' ? 'erro' : 'sucesso'}>{RESULTADO_PECA[p.resultado] ?? p.resultado}</Etiqueta> : null}{p.resultadoObs ? <Legenda><bdi>{p.resultadoObs}</bdi></Legenda> : null}
        {p.status === 'protocolada' && pode('juridico', 'elaborar_peca') ? <div className="flex flex-wrap items-end gap-3"><Selecao rotulo="Resultado" value={res.resultado} onChange={(v) => setRes({ ...res, resultado: v })} opcoes={Object.entries(RESULTADO_PECA).map(([valor, rotulo]) => ({ valor, rotulo }))} /><div className="w-full min-w-0 sm:min-w-64 sm:flex-1"><Campo rotulo="Observação" value={res.obs} onChange={(v) => setRes({ ...res, obs: v })} maxLength={2000} /></div><Botao carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `${base}/resultado`, { resultado: res.resultado, observacao: res.obs.trim() || null }); recarregar() })}>Registrar resultado</Botao></div> : null}</Cartao> : null}
    </Pagina>
  )
}
