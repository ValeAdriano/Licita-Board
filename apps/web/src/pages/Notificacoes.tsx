import { useAcesso } from '../features/acesso/contexto'

// Notificações do próprio usuário (criadas só pelo worker). Clicar marca como lida; cada item diz de
// qual empresa é (prazo de uma não pode parecer de outra).
export default function Notificacoes() {
  const { notificacoes, marcarLida, vinculos } = useAcesso()
  const nomeEmpresa = (id: string | null) => vinculos.find((v) => v.empresaId === id)?.empresa
  return (
    <div className="conteudo__miolo entra">
      <h1>Notificações</h1>
      {notificacoes.length === 0 ? (
        <p className="vazio">Nenhuma notificação.</p>
      ) : (
        <div className="lista">
          {notificacoes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={n.lidaEm ? 'lista__item' : 'lista__item lista__item--nao-lida'}
              aria-label={`${n.lidaEm ? '' : 'Não lida: '}${n.titulo}`}
              onClick={() => (n.lidaEm ? undefined : void marcarLida(n.id).catch(() => {}))}
            >
              <span className="lista__texto">
                {nomeEmpresa(n.empresaId) ? <span className="legenda" style={{ color: 'var(--acento)', fontWeight: 600 }}>{nomeEmpresa(n.empresaId)}</span> : null}
                <strong>{n.titulo}</strong>
                {n.corpo ? <span>{n.corpo}</span> : null}
                <span className="legenda">{new Date(n.criadaEm).toLocaleString('pt-BR')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
