import { type Acao, ACOES, acaoPermitida, chave, type Modulo, type Papel } from '../../lib/permissoes/matriz'

type Props = {
  modulos: Modulo[]
  papel: Papel
  selecao: Set<string>
  aoMudar?: (nova: Set<string>) => void
  somenteLeitura?: boolean
}

// Mobile-first: no celular, um bloco por módulo com as ações em lista; no desktop, tabela módulo × ação.
export function MatrizEditavel({ modulos, papel, selecao, aoMudar, somenteLeitura }: Props) {
  function alternar(modulo: string, acao: Acao) {
    if (!aoMudar) return
    const nova = new Set(selecao)
    const k = chave(modulo, acao)
    if (nova.has(k)) nova.delete(k)
    else nova.add(k)
    aoMudar(nova)
  }

  function marcarModulo(modulo: string, marcar: boolean) {
    if (!aoMudar) return
    const nova = new Set(selecao)
    for (const { id } of ACOES) {
      if (!acaoPermitida(papel, id)) continue
      if (marcar) nova.add(chave(modulo, id))
      else nova.delete(chave(modulo, id))
    }
    aoMudar(nova)
  }

  const desabilitada = (acao: Acao) => somenteLeitura || !acaoPermitida(papel, acao)

  return (
    <>
      <div className="space-y-2 md:hidden">
        {modulos.map((m) => {
          const total = ACOES.filter((a) => selecao.has(chave(m.slug, a.id))).length
          return (
            <details key={m.slug} className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <summary className="flex min-h-12 cursor-pointer items-center justify-between px-3 text-sm font-medium">
                {m.nome}
                <span className="text-xs text-slate-500">{total ? `${total} ações` : 'sem acesso'}</span>
              </summary>
              <ul className="border-t border-slate-200 px-3 py-2 dark:border-slate-800">
                {ACOES.map((a) => (
                  <li key={a.id}>
                    <label className={`flex min-h-11 items-center gap-3 text-sm ${desabilitada(a.id) ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={selecao.has(chave(m.slug, a.id))}
                        disabled={desabilitada(a.id)}
                        onChange={() => alternar(m.slug, a.id)}
                      />
                      {a.rotulo}
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block dark:border-slate-800">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Permissões por módulo e ação</caption>
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left font-medium dark:bg-slate-900">
                Módulo
              </th>
              {ACOES.map((a) => (
                <th key={a.id} scope="col" className="px-1 py-2 text-center text-[11px] font-medium leading-tight">
                  {a.rotulo}
                </th>
              ))}
              {!somenteLeitura && <th scope="col" className="sr-only">Todos</th>}
            </tr>
          </thead>
          <tbody>
            {modulos.map((m) => (
              <tr key={m.slug} className="border-t border-slate-200 dark:border-slate-800">
                <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left font-normal dark:bg-slate-950">
                  {m.nome}
                </th>
                {ACOES.map((a) => (
                  <td key={a.id} className="px-1 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${m.nome}: ${a.rotulo}`}
                      className="size-4"
                      checked={selecao.has(chave(m.slug, a.id))}
                      disabled={desabilitada(a.id)}
                      onChange={() => alternar(m.slug, a.id)}
                    />
                  </td>
                ))}
                {!somenteLeitura && (
                  <td className="whitespace-nowrap px-2 text-xs">
                    <button type="button" className="underline" onClick={() => marcarModulo(m.slug, true)}>
                      todos
                    </button>{' '}
                    ·{' '}
                    <button type="button" className="underline" onClick={() => marcarModulo(m.slug, false)}>
                      nenhum
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
