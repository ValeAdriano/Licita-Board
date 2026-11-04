import { Checkbox } from '@/components/base/checkbox/checkbox'
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
    <div className="flex flex-col gap-3">
      {modulos.map((m) => (
        <section key={m.slug} className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary" aria-label={m.nome}>
          <h3>{m.nome}</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACOES.map((a) => {
              const marcada = selecao.has(chave(m.slug, a.id))
              const alemDoTeto = !marcada && podeConceder !== undefined && !podeConceder(m.slug, a.id)
              const bloqueada = somenteLeitura || !acaoPermitida(papel, a.id) || alemDoTeto
              return (
                <Checkbox
                  key={a.id}
                  size="md"
                  label={a.rotulo}
                  aria-label={`${m.nome}: ${a.rotulo}`}
                  isSelected={marcada}
                  isDisabled={bloqueada}
                  onChange={() => aoMudar(alternar(selecao, m.slug, a.id))}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
