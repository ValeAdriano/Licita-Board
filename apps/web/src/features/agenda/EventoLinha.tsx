import { Link } from 'react-router'
import { Etiqueta } from '../../ui'
import { corDoStatus, dataHoraSP, STATUS_EVENTO, TIPO_EVENTO, type EventoAgenda } from './comum'

// Selos que nunca podem sumir de um prazo: provisório (abertura não confirmada) e regra não validada pelo jurídico.
export function SelosDoPrazo({ e }: { e: Pick<EventoAgenda, 'provisorio' | 'regraValidada' | 'origemPrazo' | 'tipo'> }) {
  return (
    <>
      {e.provisorio ? <Etiqueta cor="aviso">Provisório</Etiqueta> : null}
      {!e.regraValidada && e.origemPrazo === 'regra' && e.tipo !== 'disputa' ? <Etiqueta cor="aviso">⚖️ Regra não validada</Etiqueta> : null}
      {e.origemPrazo === 'edital' ? <Etiqueta cor="marca">Prazo do edital</Etiqueta> : null}
      {e.origemPrazo === 'manual' ? <Etiqueta cor="marca">Ajustado à mão</Etiqueta> : null}
    </>
  )
}

// Um evento da agenda em cartão (usado no dia, na semana e na lista do celular).
export function EventoLinha({ e }: { e: EventoAgenda }) {
  const aberto = ['sugerido', 'em_elaboracao', 'em_revisao', 'aprovado'].includes(e.status)
  return (
    <Link
      to={`/agenda/acompanhamentos/${e.acompanhamentoId}`}
      className="flex flex-col gap-1.5 rounded-lg p-3 text-left no-underline ring-1 ring-secondary ring-inset hover:bg-primary_hover"
    >
      <span className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-primary">{TIPO_EVENTO[e.tipo] ?? e.tipo}</strong>
        <Etiqueta cor={corDoStatus(e.status)}>{STATUS_EVENTO[e.status] ?? e.status}</Etiqueta>
        <SelosDoPrazo e={e} />
      </span>
      <span className="text-sm text-secondary [overflow-wrap:anywhere]"><bdi>{e.orgao}</bdi> · {e.municipio ?? '—'}/{e.uf ?? '—'}{e.numeroEdital ? ` · nº ${e.numeroEdital}` : ''}</span>
      <span className="text-sm text-tertiary">
        {e.tipo === 'disputa' ? 'Abertura' : 'Prazo'} {dataHoraSP(e.dataLimite)}
        {aberto && e.dataInterna && e.tipo !== 'disputa' ? ` · interno ${dataHoraSP(e.dataInterna)}` : ''}
        {e.responsavel ? ` · ${e.responsavel}` : ''}
      </span>
    </Link>
  )
}
