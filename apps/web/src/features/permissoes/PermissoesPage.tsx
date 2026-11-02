import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Aviso, Botao } from '../../components/ui'
import { nomeDaEmpresa, useEmpresaAtiva } from '../../lib/empresa/EmpresaAtiva'
import { PAPEIS } from '../../lib/permissoes/matriz'
import { supabase } from '../../lib/supabase'
import { ConvidarUsuario } from './ConvidarUsuario'
import { useConvitesPendentes, useModulos, usePodeNaEmpresa, useVinculos } from './dados'
import { EditorVinculo } from './EditorVinculo'

const rotuloPapel = (p: string) => PAPEIS.find((x) => x.id === p)?.rotulo ?? p
const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

// Matriz de permissões (Prompt 1.3) da empresa ativa. Quem decide o que cada um vê e faz é o banco;
// esta tela só lê e chama as RPCs (salvar_vinculo, convidar_usuario, revogar_convite) com step-up.
export function PermissoesPage() {
  const { ativa } = useEmpresaAtiva()
  // Trocar de empresa remonta a tela: nada em edição ou convite em andamento vai para a empresa errada.
  return <PermissoesDaEmpresa key={ativa?.id ?? 'nenhuma'} />
}

function PermissoesDaEmpresa() {
  const { ativa } = useEmpresaAtiva()
  const empresaId = ativa?.id
  const queryClient = useQueryClient()
  const podeVer = usePodeNaEmpresa(empresaId, 'usuarios', 'visualizar')
  const podeVerPermissoes = usePodeNaEmpresa(empresaId, 'permissoes', 'visualizar')
  const podeAdministrar = usePodeNaEmpresa(empresaId, 'permissoes', 'administrar_permissoes')
  const modulos = useModulos()
  const vinculos = useVinculos(podeVer.data ? empresaId : undefined)
  const convites = useConvitesPendentes(podeVerPermissoes.data ? empresaId : undefined)
  const [editando, setEditando] = useState<string | null>(null)
  const [convidando, setConvidando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (!ativa) return <div className="p-4"><Aviso>Selecione uma empresa.</Aviso></div>
  if (podeVer.isPending) return <p className="p-4 text-sm">Carregando…</p>
  if (!podeVer.data) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl font-semibold">Usuários e permissões</h1>
        <Aviso>Você não tem permissão para ver os usuários de {nomeDaEmpresa(ativa)}.</Aviso>
      </div>
    )
  }

  const vinculoEmEdicao = vinculos.data?.find((v) => v.id === editando)

  async function revogar(id: string) {
    setErro(null)
    const { error } = await supabase.schema('core').rpc('revogar_convite', { p_convite: id })
    if (error) setErro('Não foi possível revogar o convite.')
    await queryClient.invalidateQueries({ queryKey: ['convites', empresaId] })
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="mb-1 text-2xl font-semibold">Usuários e permissões</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{nomeDaEmpresa(ativa)}</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {vinculoEmEdicao && modulos.data ? (
        <EditorVinculo
          key={vinculoEmEdicao.id}
          vinculo={vinculoEmEdicao}
          modulos={modulos.data}
          podeAdministrar={Boolean(podeAdministrar.data)}
          aoFechar={() => setEditando(null)}
        />
      ) : convidando && modulos.data ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Convidar usuário</h2>
            <button type="button" onClick={() => setConvidando(false)} className="min-h-11 px-2 text-sm underline">
              Cancelar
            </button>
          </div>
          <ConvidarUsuario empresaId={ativa.id} modulos={modulos.data} aoConcluir={() => setConvidando(false)} />
        </section>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Usuários</h2>
            {podeAdministrar.data && (
              <div>
                <Botao onClick={() => setConvidando(true)}>Convidar usuário</Botao>
              </div>
            )}
          </div>
          {vinculos.isError && <Aviso tipo="erro">Não foi possível carregar os usuários.</Aviso>}
          <ul className="mb-8 space-y-2">
            {vinculos.data?.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setEditando(v.id)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.usuarios?.nome || v.usuarios?.email || 'Usuário'}</span>
                    <span className="block truncate text-slate-500">{v.usuarios?.email}</span>
                  </span>
                  <span className="shrink-0 text-xs">{rotuloPapel(v.papel)}</span>
                  {!v.ativo && <span className="shrink-0 rounded bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">inativo</span>}
                </button>
              </li>
            ))}
          </ul>

          {podeVerPermissoes.data && <h2 className="mb-3 text-lg font-semibold">Convites pendentes</h2>}
          {convites.data?.length === 0 && <p className="text-sm text-slate-500">Nenhum convite pendente.</p>}
          <ul className="space-y-2">
            {convites.data?.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.email}</span>
                  <span className="block text-slate-500">
                    {rotuloPapel(c.papel)} · expira em {data.format(new Date(c.expira_em))}
                  </span>
                </span>
                {podeAdministrar.data && (
                  <button type="button" onClick={() => void revogar(c.id)} className="min-h-11 shrink-0 px-2 text-xs underline">
                    Revogar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
