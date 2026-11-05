import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Modal, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { corDoStatus, dataHoraSP, FATOS, paraCampoLocal, paraIsoSP, STATUS_EVENTO, TIPO_EVENTO } from './comum'
import { SelosDoPrazo } from './EventoLinha'
import type { Detalhe, EventoDet, Historico } from './tiposAcompanhamento'

const STATUS_LIVRES = ['sugerido', 'em_elaboracao', 'em_revisao', 'aprovado', 'protocolado', 'respondido', 'dispensado']

// Prazos do edital: status, responsável, override com justificativa e fatos geradores registrados à mão
// (até as Fases 09 e 10 automatizarem). A data-limite só muda pelo worker, por override ou pelo edital.
export function Eventos({ empresaId, d, responsaveis, podeEditar, aoMudar }: {
  empresaId: string; d: Detalhe; responsaveis: { id: string; nome: string }[]; podeEditar: boolean; aoMudar: () => void
}) {
  const [alvo, setAlvo] = useState<{ ev: EventoDet; modo: 'prazo' | 'dispensar' | 'historico' } | null>(null)
  const [fato, setFato] = useState({ tipo: 'resposta_administracao', quando: '' })
  const { enviando, erro, ok, enviar } = useEnvio()
  const mudarStatus = (ev: EventoDet, status: string) => {
    if (status === 'dispensado' || ev.status === 'prazo_perdido') return setAlvo({ ev: { ...ev, status }, modo: 'dispensar' })
    return enviar(async () => { await chamar('POST', `/empresas/${empresaId}/eventos/${ev.id}/status`, { status }); aoMudar() })
  }
  const registrarFato = () =>
    enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/acompanhamentos/${d.id}/fatos`, { tipo: fato.tipo, dataBase: paraIsoSP(fato.quando) })
      setFato({ ...fato, quando: '' })
      aoMudar()
      return 'Fato registrado. O prazo aparece em instantes.'
    })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-prazos">
      <h2 id="h-prazos">Prazos e eventos</h2>
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {d.eventos.length === 0 ? <Vazio>{d.dataAbertura ? 'Calculando os prazos…' : 'Confirme a abertura para gerar os prazos.'}</Vazio> : null}
      <div className="flex flex-col gap-3">
        {d.eventos.map((ev) => (
          <article key={ev.id} className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary ring-inset">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm text-primary">{TIPO_EVENTO[ev.tipo] ?? ev.tipo}</strong>
              <Etiqueta cor={corDoStatus(ev.status)}>{STATUS_EVENTO[ev.status] ?? ev.status}</Etiqueta>
              <SelosDoPrazo e={ev} />
            </div>
            <Legenda>
              {ev.tipo === 'disputa' ? 'Abertura' : 'Prazo legal'}: <strong>{dataHoraSP(ev.dataLimite)}</strong>
              {ev.tipo !== 'disputa' && ev.dataInterna ? ` · data interna recomendada ${dataHoraSP(ev.dataInterna)}` : ''}
            </Legenda>
            <Legenda>
              {ev.origemPrazo === 'edital' ? `Prazo fixado pelo edital${ev.clausula ? ` (${ev.clausula})` : ''}` : ev.origemPrazo === 'manual' ? 'Ajustado à mão' : `Regra: ${ev.artigo ?? '—'}`}
              {ev.justificativa ? ` · Justificativa: ${ev.justificativa}` : ''}
            </Legenda>
            {ev.aviso ? <Legenda>⚠ {ev.aviso}</Legenda> : null}
            {podeEditar && ev.tipo !== 'disputa' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Selecao rotulo="Situação" value={ev.status === 'prazo_perdido' ? '' : ev.status} vazio={ev.status === 'prazo_perdido' ? 'Prazo perdido' : undefined} onChange={(v) => v && void mudarStatus(ev, v)}
                  opcoes={STATUS_LIVRES.map((s) => ({ valor: s, rotulo: STATUS_EVENTO[s] ?? s }))} />
                <Selecao rotulo="Responsável" value={ev.responsavelId ?? ''} vazio="Do acompanhamento" disabled={enviando}
                  onChange={(v) => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/eventos/${ev.id}/responsavel`, { responsavelId: v || null }); aoMudar() })}
                  opcoes={responsaveis.map((r) => ({ valor: r.id, rotulo: r.nome }))} />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {podeEditar && ev.tipo !== 'disputa' ? <Botao variante="secundario" onClick={() => setAlvo({ ev, modo: 'prazo' })}>Ajustar prazo…</Botao> : null}
              <Botao variante="texto" onClick={() => setAlvo({ ev, modo: 'historico' })}>Histórico</Botao>
            </div>
          </article>
        ))}
      </div>
      {podeEditar && d.aberturaConfirmada ? (
        <div className="flex flex-col gap-3 rounded-lg bg-secondary p-3">
          <h3>Registrar fato gerador</h3>
          <Legenda>EM DESENVOLVIMENTO: nas Fases 9 e 10 estes fatos serão registrados sozinhos. Até lá, informe quando aconteceram para gerar o prazo.</Legenda>
          <div className="grid gap-3 sm:grid-cols-2">
            <Selecao rotulo="O que aconteceu" value={fato.tipo} onChange={(v) => setFato({ ...fato, tipo: v })} opcoes={Object.entries(FATOS).map(([valor, rotulo]) => ({ valor, rotulo }))} />
            <Campo rotulo="Quando (horário de Brasília)" type="datetime-local" value={fato.quando} onChange={(v) => setFato({ ...fato, quando: v })} />
          </div>
          <div><Botao variante="secundario" disabled={!fato.quando} carregando={enviando} onClick={() => void registrarFato()}>Registrar</Botao></div>
        </div>
      ) : null}
      {alvo?.modo === 'prazo' ? <AjustarPrazo empresaId={empresaId} ev={alvo.ev} aoFechar={() => setAlvo(null)} aoSalvar={() => { setAlvo(null); aoMudar() }} /> : null}
      {alvo?.modo === 'dispensar' ? <Dispensar empresaId={empresaId} ev={alvo.ev} aoFechar={() => setAlvo(null)} aoSalvar={() => { setAlvo(null); aoMudar() }} /> : null}
      {alvo?.modo === 'historico' ? <HistoricoModal ev={alvo.ev} historico={d.historico} aoFechar={() => setAlvo(null)} /> : null}
    </section>
  )
}

function AjustarPrazo({ empresaId, ev, aoFechar, aoSalvar }: { empresaId: string; ev: EventoDet; aoFechar: () => void; aoSalvar: () => void }) {
  const [quando, setQuando] = useState(paraCampoLocal(ev.dataLimite))
  const [just, setJust] = useState('')
  const { enviando, erro, enviar } = useEnvio()
  return (
    <Modal aberto titulo={`Ajustar prazo: ${TIPO_EVENTO[ev.tipo] ?? ev.tipo}`} aoFechar={aoFechar}>
      <Legenda>O ajuste fica no histórico e na auditoria, e o recálculo automático não o sobrescreve. Prazo atual: {dataHoraSP(ev.dataLimite)}.</Legenda>
      <Campo rotulo="Nova data-limite (Brasília)" type="datetime-local" value={quando} onChange={setQuando} />
      <Campo rotulo="Justificativa (mínimo 10 caracteres)" value={just} onChange={setJust} maxLength={1000} />
      <Aviso texto={erro} />
      <div className="flex flex-wrap gap-3">
        <Botao carregando={enviando} disabled={!quando || just.trim().length < 10}
          onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/eventos/${ev.id}/prazo`, { dataLimite: paraIsoSP(quando), justificativa: just.trim() }); aoSalvar() })}>Salvar ajuste</Botao>
        <Botao variante="texto" onClick={aoFechar}>Cancelar</Botao>
      </div>
    </Modal>
  )
}

function Dispensar({ empresaId, ev, aoFechar, aoSalvar }: { empresaId: string; ev: EventoDet; aoFechar: () => void; aoSalvar: () => void }) {
  const [just, setJust] = useState('')
  const { enviando, erro, enviar } = useEnvio()
  const sobPerdido = ev.status !== 'dispensado'
  return (
    <Modal aberto titulo={sobPerdido ? 'Reabrir prazo perdido' : 'Dispensar evento'} aoFechar={aoFechar}>
      <Legenda>{sobPerdido ? `Mudar um prazo perdido para “${STATUS_EVENTO[ev.status]}” exige justificativa.` : 'Dispensar exige justificativa; fica no histórico.'}</Legenda>
      <Campo rotulo="Justificativa (mínimo 10 caracteres)" value={just} onChange={setJust} maxLength={1000} />
      <Aviso texto={erro} />
      <div className="flex flex-wrap gap-3">
        <Botao carregando={enviando} disabled={just.trim().length < 10}
          onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/eventos/${ev.id}/status`, { status: ev.status, justificativa: just.trim() }); aoSalvar() })}>Confirmar</Botao>
        <Botao variante="texto" onClick={aoFechar}>Cancelar</Botao>
      </div>
    </Modal>
  )
}

function HistoricoModal({ ev, historico, aoFechar }: { ev: EventoDet; historico: Historico[]; aoFechar: () => void }) {
  const itens = historico.filter((h) => h.eventoId === ev.id)
  return (
    <Modal aberto titulo={`Histórico: ${TIPO_EVENTO[ev.tipo] ?? ev.tipo}`} aoFechar={aoFechar}>
      {itens.length === 0 ? <Vazio>Sem alterações registradas.</Vazio> : null}
      <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {itens.map((h) => (
          <li key={h.id} className="rounded-lg p-2 text-sm ring-1 ring-secondary ring-inset">
            <strong className="text-primary">{h.campo === 'data_limite_legal' ? 'Data-limite' : h.campo === 'status' ? 'Situação' : h.campo}</strong>
            <span className="block text-tertiary">{h.antes ?? '—'} → {h.depois ?? '—'}</span>
            <span className="block text-xs text-tertiary">{dataHoraSP(h.em)}{h.quem ? ` · ${h.quem}` : ' · cálculo automático'}{h.motivo ? ` · ${h.motivo}` : ''}</span>
          </li>
        ))}
      </ul>
      <Botao variante="secundario" onClick={aoFechar}>Fechar</Botao>
    </Modal>
  )
}
