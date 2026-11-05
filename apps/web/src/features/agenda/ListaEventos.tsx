import { useNavigate } from 'react-router'
import { Table } from '@/components/application/table/table'
import { Aviso, Etiqueta, Vazio } from '../../ui'
import { useGet } from '../acesso/useGet'
import { corDoStatus, dataHoraSP, STATUS_EVENTO, TIPO_EVENTO, type EventoAgenda } from './comum'
import { EventoLinha, SelosDoPrazo } from './EventoLinha'

// Lista de prazos: tabela no desktop (Untitled UI Table) e cartões no celular. Vencidos e perdidos vêm primeiro
// na ordenação por data; "Prazo perdido" fica em destaque.
export function ListaEventos({ empresaId, filtro }: { empresaId: string; filtro: string }) {
  const q = `/empresas/${empresaId}/agenda/eventos${filtro ? `?${filtro.slice(1)}` : ''}` // filtro vem como "&a=1&b=2"
  const eventos = useGet<EventoAgenda[]>(q)
  const navegar = useNavigate()
  const lista = eventos.dados ?? []
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={eventos.erro} />
      {eventos.carregando ? <p className="text-sm text-tertiary">Carregando…</p> : null}
      {!eventos.carregando && lista.length === 0 ? <Vazio>Nenhum prazo com estes filtros. Acompanhe um edital em Oportunidades para gerar os prazos.</Vazio> : null}
      <div className="hidden md:block">
        {lista.length > 0 ? (
          <div className="overflow-hidden rounded-xl shadow-xs ring-1 ring-secondary">
            <Table aria-label="Prazos da agenda" size="sm" onRowAction={(k) => { const ev = lista.find((x) => x.id === String(k)); if (ev) void navegar(`/agenda/acompanhamentos/${ev.acompanhamentoId}`) }}>
              <Table.Header>
                <Table.Head id="prazo" isRowHeader label="Prazo" />
                <Table.Head id="evento" label="Evento" />
                <Table.Head id="orgao" label="Órgão e edital" />
                <Table.Head id="resp" label="Responsável" />
                <Table.Head id="status" label="Situação" />
              </Table.Header>
              <Table.Body items={lista.map((e) => ({ ...e, key: e.id }))}>
                {(e) => (
                  <Table.Row id={e.id}>
                    <Table.Cell className="whitespace-nowrap font-medium text-primary">
                      {dataHoraSP(e.dataLimite)}
                      {e.tipo !== 'disputa' && e.dataInterna ? <span className="block text-xs font-normal text-tertiary">interno {dataHoraSP(e.dataInterna)}</span> : null}
                    </Table.Cell>
                    <Table.Cell>{TIPO_EVENTO[e.tipo] ?? e.tipo}</Table.Cell>
                    <Table.Cell className="max-w-72"><span className="block truncate text-secondary"><bdi>{e.orgao}</bdi></span><span className="block truncate text-xs">{e.numeroEdital ? `nº ${e.numeroEdital} · ` : ''}<bdi>{e.objeto}</bdi></span></Table.Cell>
                    <Table.Cell>{e.responsavel ?? '—'}</Table.Cell>
                    <Table.Cell>
                      <span className="flex flex-wrap gap-1"><Etiqueta cor={corDoStatus(e.status)}>{STATUS_EVENTO[e.status] ?? e.status}</Etiqueta><SelosDoPrazo e={e} /></span>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 md:hidden">{lista.map((e) => <EventoLinha key={e.id} e={e} />)}</div>
    </div>
  )
}
