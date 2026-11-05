import { Link } from 'react-router'
import { Aviso, Etiqueta, Vazio } from '../../ui'
import { useGet } from '../acesso/useGet'
import { dataHoraSP, PRIORIDADE, STATUS_ACOMP, type Acompanhado } from './comum'

// Editais que a empresa acompanha: abertura (confirmada ou sugerida), próximo prazo, itens e alertas.
export function Acompanhados({ empresaId }: { empresaId: string }) {
  const lista = useGet<Acompanhado[]>(`/empresas/${empresaId}/agenda/acompanhamentos`)
  return (
    <div className="flex flex-col gap-3">
      <Aviso texto={lista.erro} />
      {lista.carregando ? <p className="text-sm text-tertiary">Carregando…</p> : null}
      {lista.dados?.length === 0 ? <Vazio>Nenhum edital acompanhado ainda. Em Oportunidades, use “Acompanhar”.</Vazio> : null}
      {lista.dados?.map((a) => (
        <Link key={a.id} to={`/agenda/acompanhamentos/${a.id}`} className="flex flex-col gap-2 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="text-md text-primary [overflow-wrap:anywhere]"><bdi>{a.orgao}</bdi></strong>
            <Etiqueta cor="cinza">{STATUS_ACOMP[a.status] ?? a.status}</Etiqueta>
            {a.prioridade !== 'normal' ? <Etiqueta cor={a.prioridade === 'urgente' ? 'erro' : 'marca'}>{PRIORIDADE[a.prioridade]}</Etiqueta> : null}
            {a.editalAlterado ? <Etiqueta cor="aviso">Edital retificado: confira</Etiqueta> : null}
            {a.prazosPerdidos > 0 ? <Etiqueta cor="erro">{a.prazosPerdidos} prazo(s) perdido(s)</Etiqueta> : null}
          </span>
          <span className="text-sm text-secondary [overflow-wrap:anywhere]">{a.numeroEdital ? `Edital nº ${a.numeroEdital} · ` : ''}<bdi>{a.objeto}</bdi></span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tertiary">
            <span>{a.municipio ?? '—'}/{a.uf ?? '—'}</span>
            <span>Abertura {dataHoraSP(a.dataAbertura)} {a.aberturaConfirmada ? <Etiqueta cor="sucesso">Confirmada</Etiqueta> : <Etiqueta cor="aviso">A confirmar</Etiqueta>}</span>
            <span>Próximo prazo {dataHoraSP(a.proximoPrazo)}</span>
            <span>{a.itens} {a.itens === 1 ? 'item' : 'itens'}</span>
            <span>{a.responsavel ?? 'Sem responsável'}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
