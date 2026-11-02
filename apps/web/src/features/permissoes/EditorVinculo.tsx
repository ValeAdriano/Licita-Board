import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { StepUpDialog } from '../../components/StepUpDialog'
import { Aviso, Botao } from '../../components/ui'
import { filtrarPorPapel, iguais, type Modulo, type Papel, PAPEIS, sugestaoPorPapel } from '../../lib/permissoes/matriz'
import { mensagemBloqueioPermissao } from '../../lib/stepUp'
import { supabase } from '../../lib/supabase'
import { permissoesDoVinculo, type VinculoLinha } from './dados'
import { MatrizEditavel } from './MatrizEditavel'

type Props = { vinculo: VinculoLinha; modulos: Modulo[]; podeAdministrar: boolean; aoFechar: () => void }

export function EditorVinculo({ vinculo, modulos, podeAdministrar, aoFechar }: Props) {
  const queryClient = useQueryClient()
  const atuais = useQuery({ queryKey: ['permissoes', vinculo.id], queryFn: () => permissoesDoVinculo(vinculo.id) })
  const [papel, setPapel] = useState<Papel>(vinculo.papel)
  const [ativo, setAtivo] = useState(vinculo.ativo)
  const [selecao, setSelecao] = useState<Set<string>>(new Set())
  // O que vai ser gravado é congelado ao abrir a confirmação: mudanças na tela depois disso não entram.
  const [pendente, setPendente] = useState<{ papel: Papel; ativo: boolean; permissoes: string[] } | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    if (atuais.data) setSelecao(new Set(atuais.data))
  }, [atuais.data])

  const alterado =
    papel !== vinculo.papel || ativo !== vinculo.ativo || (atuais.data !== undefined && !iguais(selecao, atuais.data))
  const nome = vinculo.usuarios?.nome || vinculo.usuarios?.email || 'Usuário'

  function trocarPapel(novo: Papel) {
    setPapel(novo)
    setSelecao((s) => filtrarPorPapel(novo, s))
  }

  async function salvar(token: string): Promise<string | null> {
    if (!pendente) return 'Nada para salvar.'
    const { error } = await supabase.schema('core').rpc('salvar_vinculo', {
      p_vinculo: vinculo.id,
      p_papel: pendente.papel,
      p_ativo: pendente.ativo,
      p_permissoes: pendente.permissoes,
      p_step_up: token,
    })
    if (error) {
      setPendente(null)
      setAviso({ tipo: 'erro', texto: mensagemBloqueioPermissao(error.message) ?? 'Não foi possível salvar. Recarregue e tente de novo.' })
      return null
    }
    setPendente(null)
    setAviso({ tipo: 'sucesso', texto: 'Permissões salvas.' })
    await queryClient.invalidateQueries({ queryKey: ['permissoes', vinculo.id] })
    await queryClient.invalidateQueries({ queryKey: ['vinculos'] })
    await queryClient.invalidateQueries({ queryKey: ['acesso'] })
    return null
  }

  return (
    <section aria-labelledby="editor-titulo" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="editor-titulo" className="text-lg font-semibold">
            {nome}
          </h2>
          <p className="text-sm text-slate-500">{vinculo.usuarios?.email}</p>
        </div>
        <button type="button" onClick={aoFechar} className="min-h-11 px-2 text-sm underline">
          Fechar
        </button>
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {!podeAdministrar && <Aviso>Você pode ver estas permissões, mas não alterá-las.</Aviso>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Papel</span>
          <select
            value={papel}
            disabled={!podeAdministrar}
            onChange={(e) => trocarPapel(e.target.value as Papel)}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
          >
            {PAPEIS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end text-sm">
          <input type="checkbox" className="size-5" checked={ativo} disabled={!podeAdministrar} onChange={(e) => setAtivo(e.target.checked)} />
          Acesso ativo
        </label>
      </div>

      {podeAdministrar && (
        <button type="button" className="mb-3 min-h-11 text-sm underline" onClick={() => setSelecao(sugestaoPorPapel(papel, modulos))}>
          Aplicar sugestão para o papel (revise antes de salvar)
        </button>
      )}

      {atuais.isPending ? (
        <p className="text-sm">Carregando permissões…</p>
      ) : (
        <MatrizEditavel modulos={modulos} papel={papel} selecao={selecao} aoMudar={setSelecao} somenteLeitura={!podeAdministrar} />
      )}

      {podeAdministrar && (
        <div className="sticky bottom-16 mt-4 md:static">
          <Botao disabled={!alterado} onClick={() => setPendente({ papel, ativo, permissoes: [...selecao].sort() })}>
            Salvar alterações
          </Botao>
        </div>
      )}

      <StepUpDialog
        aberto={pendente !== null}
        escopo="alterar_permissoes"
        descricao="Alterar permissões é uma operação crítica. Digite o código do autenticador para confirmar."
        aoConfirmar={salvar}
        aoCancelar={() => setPendente(null)}
      />
    </section>
  )
}
