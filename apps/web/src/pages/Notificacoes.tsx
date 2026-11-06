import { useNavigate } from 'react-router'
import { Botao, CabecalhoPagina, Pagina } from '../ui'
import { useAcesso } from '../features/acesso/contexto'

// Notificações do próprio usuário (criadas só pelo worker). Clicar marca como lida; cada item diz de
// qual empresa é (prazo de uma não pode parecer de outra).
export default function Notificacoes() {
  const { notificacoes, marcarLida, vinculos, empresa, escolherEmpresa, naoLidas } = useAcesso()
  const navegar = useNavigate()
  const nomeEmpresa = (id: string | null) => vinculos.find((v) => v.empresaId === id)?.empresa
  return (
    <Pagina>
      <CabecalhoPagina titulo="Notificações" acoes={naoLidas > 0 ? <Botao variante="secundario" onClick={() => void Promise.all(notificacoes.filter((n) => !n.lidaEm).map((n) => marcarLida(n.id).catch(() => undefined)))}>Marcar todas como lidas</Botao> : undefined} />
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
              // Um clique: marca como lida e já abre o item (na empresa certa), em vez de só mudar a cor.
              onClick={() => {
                if (!n.lidaEm) void marcarLida(n.id).catch(() => undefined)
                if (n.link) {
                  if (n.empresaId && n.empresaId !== empresa?.empresaId) escolherEmpresa(n.empresaId)
                  void navegar(n.link)
                }
              }}
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
