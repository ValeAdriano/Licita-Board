import { useState } from 'react'
import { Link } from 'react-router'
import { Abas, Aviso, Botao, Vazio } from '../../ui'
import { useGet } from '../acesso/useGet'
import {
  corDoStatus, DIAS_CURTOS, diaSP, grade, hojeSP, horaSP, inicioDaSemana, inicioDoDia, mesDe, somarDias, somarMeses, TIPO_CURTO, tituloDoDia, tituloDoMes,
  type EventoAgenda,
} from './comum'
import { EventoLinha } from './EventoLinha'

type Visao = 'mes' | 'semana' | 'dia'

const FUNDO: Record<string, string> = {
  erro: 'bg-error-primary text-error-primary', sucesso: 'bg-success-primary text-success-primary', aviso: 'bg-warning-primary text-warning-primary',
  marca: 'bg-brand-primary text-brand-primary', cinza: 'bg-secondary text-secondary',
}
const PONTO: Record<string, string> = { erro: 'bg-error-solid', sucesso: 'bg-success-solid', aviso: 'bg-warning-solid', marca: 'bg-brand-solid', cinza: 'bg-quaternary' }
const pontoDoEvento = (e: EventoAgenda): string => PONTO[e.tipo === 'disputa' && e.status !== 'prazo_perdido' ? 'marca' : corDoStatus(e.status)] ?? 'bg-quaternary'
const classeDoEvento = (e: EventoAgenda): string =>
  `${FUNDO[e.tipo === 'disputa' && e.status !== 'prazo_perdido' ? 'marca' : corDoStatus(e.status)]}${e.provisorio ? ' border border-dashed border-warning' : ''}`

// Calendário: mês (grade), semana e dia. Mostra o prazo-limite de cada evento; clicar abre o acompanhamento.
// No celular a grade mostra só marcadores e a lista do dia selecionado aparece embaixo.
export function Calendario({ empresaId, filtro }: { empresaId: string; filtro: string }) {
  const [visao, setVisao] = useState<Visao>('mes')
  const [cursor, setCursor] = useState(hojeSP())
  const [selecionado, setSelecionado] = useState(hojeSP())
  const hoje = hojeSP()
  const semanas = grade(cursor)
  const inicioJanela = visao === 'mes' ? semanas[0]![0]! : visao === 'semana' ? inicioDaSemana(cursor) : cursor
  const fimJanela = visao === 'mes' ? somarDias(semanas.at(-1)![6]!, 1) : visao === 'semana' ? somarDias(inicioDaSemana(cursor), 7) : somarDias(cursor, 1)
  const q = `/empresas/${empresaId}/agenda/eventos?de=${encodeURIComponent(inicioDoDia(inicioJanela))}&ate=${encodeURIComponent(inicioDoDia(fimJanela))}${filtro}`
  const eventos = useGet<EventoAgenda[]>(q)
  const porDia = new Map<string, EventoAgenda[]>()
  for (const e of eventos.dados ?? []) if (e.dataLimite) porDia.set(diaSP(e.dataLimite), [...(porDia.get(diaSP(e.dataLimite)) ?? []), e])
  const passo = (n: number) => setCursor(visao === 'mes' ? somarMeses(cursor, n) : visao === 'semana' ? somarDias(cursor, 7 * n) : somarDias(cursor, n))
  const titulo = visao === 'mes' ? tituloDoMes(cursor) : visao === 'semana' ? `${tituloDoDia(inicioDaSemana(cursor))} a ${tituloDoDia(somarDias(inicioDaSemana(cursor), 6))}` : tituloDoDia(cursor)
  const irPara = (dia: string) => { setSelecionado(dia); setCursor(dia) }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Botao variante="secundario" aria-label="Anterior" onClick={() => passo(-1)}>‹</Botao>
          <Botao variante="secundario" onClick={() => irPara(hoje)}>Hoje</Botao>
          <Botao variante="secundario" aria-label="Próximo" onClick={() => passo(1)}>›</Botao>
          <h2 className="ml-2 text-lg font-semibold text-primary " aria-live="polite">{titulo}</h2>
        </div>
        <Abas rotulo="Visão do calendário" ativa={visao} aoMudar={setVisao} abas={[{ id: 'mes', rotulo: 'Mês' }, { id: 'semana', rotulo: 'Semana' }, { id: 'dia', rotulo: 'Dia' }]} />
      </div>
      <Aviso texto={eventos.erro} />

      {visao === 'mes' ? (
        <>
          <div className="overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary" role="grid" aria-label="Calendário do mês">
            <div className="grid grid-cols-7 border-b border-secondary bg-secondary" role="row">
              {DIAS_CURTOS.map((d) => <div key={d} role="columnheader" className="p-2 text-center text-xs font-medium text-tertiary">{d}</div>)}
            </div>
            {semanas.map((s) => (
              <div key={s[0]} className="grid grid-cols-7 border-b border-secondary last:border-b-0" role="row">
                {s.map((dia) => {
                  const evs = porDia.get(dia) ?? []
                  const fora = mesDe(dia) !== mesDe(cursor)
                  return (
                    <button
                      key={dia} type="button" role="gridcell" aria-label={`${tituloDoDia(dia)}${evs.length ? `, ${evs.length} prazos` : ''}`} aria-selected={dia === selecionado}
                      onClick={() => setSelecionado(dia)}
                      className={`flex min-h-16 cursor-pointer flex-col gap-1 border-r border-secondary p-1.5 text-left last:border-r-0 hover:bg-primary_hover sm:min-h-28 ${fora ? 'bg-secondary/50 text-quaternary' : ''} ${dia === selecionado ? 'bg-brand-primary' : ''}`}
                    >
                      <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${dia === hoje ? 'bg-brand-solid text-white' : 'text-secondary'}`}>{Number(dia.slice(8))}</span>
                      <span className="hidden flex-col gap-0.5 sm:flex">
                        {evs.slice(0, 3).map((e) => (
                          <span key={e.id} className={`truncate rounded px-1 py-0.5 text-[11px] leading-tight font-medium ${classeDoEvento(e)}`}>
                            {horaSP(e.dataLimite!)} {TIPO_CURTO[e.tipo] ?? e.tipo}
                          </span>
                        ))}
                        {evs.length > 3 ? <span className="px-1 text-[11px] text-tertiary">+{evs.length - 3} mais</span> : null}
                      </span>
                      {evs.length > 0 ? (
                        <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                          {evs.slice(0, 4).map((e) => <span key={e.id} className={`size-2 rounded-full ${pontoDoEvento(e)}`} />)}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <Dia dia={selecionado} eventos={porDia.get(selecionado) ?? []} carregando={eventos.carregando} />
        </>
      ) : null}

      {visao === 'semana' ? (
        <div className="grid gap-3 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => somarDias(inicioDaSemana(cursor), i)).map((dia) => (
            <section key={dia} className={`flex flex-col gap-2 rounded-xl p-2 ring-1 ring-secondary ${dia === hoje ? 'bg-brand-primary' : 'bg-primary'}`} aria-label={tituloDoDia(dia)}>
              <h3 className="text-xs font-semibold text-tertiary ">{tituloDoDia(dia)}</h3>
              {(porDia.get(dia) ?? []).map((e) => <EventoLinha key={e.id} e={e} />)}
              {(porDia.get(dia) ?? []).length === 0 ? <p className="text-xs text-quaternary">Sem prazos</p> : null}
            </section>
          ))}
        </div>
      ) : null}

      {visao === 'dia' ? <Dia dia={cursor} eventos={porDia.get(cursor) ?? []} carregando={eventos.carregando} /> : null}
      <p className="text-xs text-tertiary">Horários de Brasília. Prazos provisórios (abertura ainda não confirmada) aparecem com borda tracejada. <Link to="/agenda?aba=acompanhados">Ver editais acompanhados</Link></p>
    </div>
  )
}

function Dia({ dia, eventos, carregando }: { dia: string; eventos: EventoAgenda[]; carregando: boolean }) {
  return (
    <section className="flex flex-col gap-3" aria-label={`Prazos de ${tituloDoDia(dia)}`}>
      <h3 className="text-md font-semibold text-primary ">{tituloDoDia(dia)}</h3>
      {carregando ? <p className="text-sm text-tertiary">Carregando…</p> : null}
      {!carregando && eventos.length === 0 ? <Vazio>Nenhum prazo neste dia.</Vazio> : null}
      <div className="flex flex-col gap-2">{eventos.map((e) => <EventoLinha key={e.id} e={e} />)}</div>
    </section>
  )
}
