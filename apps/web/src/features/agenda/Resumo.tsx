import { Aviso } from '../../ui'
import { useGet } from '../acesso/useGet'
import { ABERTOS, hojeSP, inicioDoDia, diaSP, somarDias, type EventoAgenda } from './comum'
import { EventoLinha } from './EventoLinha'

// Resumo do topo da agenda: o que exige ação agora. Só conta prazo em aberto (ou já perdido nos últimos 30 dias);
// o status "Prazo perdido" é marcado pelo worker a cada hora, então há uma janela curta de "atrasado" ainda aberto.
export function Resumo({ empresaId }: { empresaId: string }) {
  const hoje = hojeSP()
  const status = [...ABERTOS, 'prazo_perdido'].join(',')
  const q = `/empresas/${empresaId}/agenda/eventos?status=${status}&de=${encodeURIComponent(inicioDoDia(somarDias(hoje, -30)))}&ate=${encodeURIComponent(inicioDoDia(somarDias(hoje, 8)))}`
  const eventos = useGet<EventoAgenda[]>(q)
  const lista = (eventos.dados ?? []).filter((e) => e.dataLimite)
  const perdidos = lista.filter((e) => e.status === 'prazo_perdido' || (e.tipo !== 'disputa' && diaSP(e.dataLimite!) < hoje))
  const emAberto = lista.filter((e) => !perdidos.includes(e))
  const hojeLista = emAberto.filter((e) => diaSP(e.dataLimite!) === hoje)
  const proximos = emAberto.filter((e) => diaSP(e.dataLimite!) > hoje && diaSP(e.dataLimite!) <= somarDias(hoje, 7))
  const urgentes = [...perdidos, ...hojeLista].slice(0, 5)
  const cartoes = [
    { rotulo: 'Prazo perdido', n: perdidos.length, destaque: perdidos.length > 0 ? 'text-error-primary' : 'text-primary' },
    { rotulo: 'Vencem hoje', n: hojeLista.length, destaque: hojeLista.length > 0 ? 'text-warning-primary' : 'text-primary' },
    { rotulo: 'Próximos 7 dias', n: proximos.length, destaque: 'text-primary' },
  ]
  if (eventos.erro) return <Aviso texto={eventos.erro} />
  return (
    <section aria-label="Resumo da agenda" className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        {cartoes.map((c) => (
          <div key={c.rotulo} className="flex flex-col gap-1 rounded-xl bg-primary p-3 shadow-xs ring-1 ring-secondary sm:p-4">
            <span className="text-xs text-tertiary sm:text-sm">{c.rotulo}</span>
            <strong className={`text-2xl sm:text-display-xs ${c.destaque}`}>{eventos.carregando ? '…' : c.n}</strong>
          </div>
        ))}
      </div>
      {urgentes.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-secondary">Precisam de atenção</h2>
          {urgentes.map((e) => <EventoLinha key={e.id} e={e} />)}
        </div>
      ) : null}
    </section>
  )
}
