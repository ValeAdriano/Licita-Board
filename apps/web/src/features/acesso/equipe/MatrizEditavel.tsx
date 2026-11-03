import { ACOES, acaoPermitida, alternar, chave, type Modulo, type Papel } from '../matriz'

// Matriz módulo × 12 ações. Cada módulo é um cartão com as ações como caixas de marcar (360 px
// primeiro). CLIENTE só recebe "Visualizar" (o banco também barra); desmarcado = sem acesso.
export function MatrizEditavel(props: {
  modulos: Modulo[]
  papel: Papel
  selecao: Set<string>
  aoMudar: (s: Set<string>) => void
  somenteLeitura: boolean
  // Quem concede não dá mais do que tem (teto, conferido no banco): o que o autor não tem fica
  // travado quando desmarcado. Só ajuda a tela; a decisão é da API.
  podeConceder?: (modulo: string, acao: string) => boolean
}) {
  const { modulos, papel, selecao, aoMudar, somenteLeitura, podeConceder } = props
  return (
    <div className="matriz">
      {modulos.map((m) => (
        <section key={m.slug} className="matriz__modulo" aria-label={m.nome}>
          <h3>{m.nome}</h3>
          <div className="matriz__acoes">
            {ACOES.map((a) => {
              const marcada = selecao.has(chave(m.slug, a.id))
              const alemDoTeto = !marcada && podeConceder !== undefined && !podeConceder(m.slug, a.id)
              const bloqueada = somenteLeitura || !acaoPermitida(papel, a.id) || alemDoTeto
              return (
                <button
                  key={a.id}
                  type="button"
                  role="checkbox"
                  aria-checked={marcada}
                  aria-label={`${m.nome}: ${a.rotulo}`}
                  disabled={bloqueada}
                  className="chip"
                  onClick={() => aoMudar(alternar(selecao, m.slug, a.id))}
                >
                  {marcada ? '✓ ' : ''}
                  {a.rotulo}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
