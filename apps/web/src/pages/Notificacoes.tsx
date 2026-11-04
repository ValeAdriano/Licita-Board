import { CabecalhoPagina, Pagina } from '../ui'
import { useAcesso } from '../features/acesso/contexto'

// Notificações do próprio usuário (criadas só pelo worker). Clicar marca como lida; cada item diz de
// qual empresa é (prazo de uma não pode parecer de outra).
export default function Notificacoes() {
  const { notificacoes, marcarLida, vinculos } = useAcesso()
  const nomeEmpresa = (id: string | null) => vinculos.find((v) => v.empresaId === id)?.empresa
  return (
    <Pagina>
      <CabecalhoPagina titulo="Notificações" />
      {notificacoes.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-tertiary">Nenhuma notificação.</p>
      ) : (
        <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
          {notificacoes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={n.lidaEm ? 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left' : 'flex min-h-14 w-full items-center gap-3 bg-brand-primary px-4 py-3 text-left'}
              aria-label={`${n.lidaEm ? '' : 'Não lida: '}${n.titulo}`}
              onClick={() => (n.lidaEm ? undefined : void marcarLida(n.id).catch(() => {}))}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                {nomeEmpresa(n.empresaId) ? <span className="text-sm font-semibold text-brand-secondary [overflow-wrap:anywhere]">{nomeEmpresa(n.empresaId)}</span> : null}
                <strong>{n.titulo}</strong>
                {n.corpo ? <span>{n.corpo}</span> : null}
                <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{new Date(n.criadaEm).toLocaleString('pt-BR')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Pagina>
  )
}
