import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Aviso, Botao } from '../../components/ui'
import { linkInterno, type Notificacao } from '../../lib/notificacoes'
import { supabase } from '../../lib/supabase'

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export function NotificacoesPage() {
  const queryClient = useQueryClient()
  const lista = useQuery({
    queryKey: ['notificacoes', 'lista'],
    queryFn: async () => {
      const { data: linhas, error } = await supabase
        .schema('core')
        .from('notificacoes')
        .select('id, tipo, titulo, corpo, link, lida_em, created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return linhas as Notificacao[]
    },
  })

  const marcar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .schema('core')
        .from('notificacoes')
        .update({ lida_em: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notificacoes'] }),
  })

  const naoLidas = (lista.data ?? []).filter((n) => !n.lida_em)

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notificações</h1>
        {naoLidas.length > 0 && (
          <div className="w-auto">
            <Botao variante="secundario" onClick={() => marcar.mutate(naoLidas.map((n) => n.id))} disabled={marcar.isPending}>
              Marcar todas como lidas
            </Botao>
          </div>
        )}
      </div>
      {lista.isPending && <p className="text-sm">Carregando…</p>}
      {(lista.isError || marcar.isError) && <Aviso tipo="erro">Não foi possível atualizar as notificações.</Aviso>}
      {lista.data?.length === 0 && <Aviso>Nenhuma notificação por enquanto.</Aviso>}
      <ul className="space-y-2">
        {lista.data?.map((n) => (
          <li
            key={n.id}
            className={`rounded-lg border p-3 text-sm ${
              n.lida_em
                ? 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                : 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{n.titulo}</p>
                {n.corpo && <p className="mt-1">{n.corpo}</p>}
                <p className="mt-1 text-xs text-slate-500">{data.format(new Date(n.created_at))}</p>
              </div>
              {!n.lida_em && (
                <button type="button" onClick={() => marcar.mutate([n.id])} className="min-h-11 shrink-0 px-2 text-xs underline">
                  Marcar como lida
                </button>
              )}
            </div>
            {linkInterno(n.link) && (
              <Link to={linkInterno(n.link) as string} className="mt-2 inline-block text-marca underline dark:text-sky-300">
                Abrir
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
