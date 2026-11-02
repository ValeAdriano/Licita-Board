import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Aviso, Botao } from '../../components/ui'
import { ACOES } from '../../lib/permissoes/matriz'
import { supabase } from '../../lib/supabase'

type Convite = { id: string; empresa: string; papel: string; permissoes: string[]; convidado_em: string; expira_em: string }

const PAPEL: Record<string, string> = { ADMIN_EMPRESA: 'Administrador', OPERADOR: 'Operador', JURIDICO: 'Jurídico', CLIENTE: 'Cliente' }

// Convites recebidos pelo e-mail do usuário logado. Aceitar cria o vínculo com as permissões do convite.
export function ConvitesPage() {
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)
  const [revisando, setRevisando] = useState<string | null>(null)
  const rotuloAcao = (id: string) => ACOES.find((a) => a.id === id)?.rotulo ?? id
  const convites = useQuery({
    queryKey: ['meus-convites'],
    queryFn: async () => {
      const { data, error } = await supabase.schema('core').rpc('meus_convites')
      if (error) throw error
      return data as Convite[]
    },
  })

  async function aceitar(c: Convite) {
    setAviso(null)
    setRevisando(null)
    const { error } = await supabase.schema('core').rpc('aceitar_convite', { p_convite: c.id })
    if (error) {
      setAviso({ tipo: 'erro', texto: 'Não foi possível aceitar. O convite pode ter expirado ou sido revogado.' })
    } else {
      setAviso({ tipo: 'sucesso', texto: `Pronto: você agora tem acesso a ${c.empresa}.` })
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['meus-convites'] }),
      queryClient.invalidateQueries({ queryKey: ['acesso'] }),
      queryClient.invalidateQueries({ queryKey: ['empresas-acessiveis'] }),
    ])
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Convites</h1>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {convites.isError && <Aviso tipo="erro">Não foi possível carregar seus convites.</Aviso>}
      {convites.data?.length === 0 && <Aviso>Nenhum convite pendente.</Aviso>}
      <ul className="space-y-3">
        {convites.data?.map((c) => (
          <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="font-medium">{c.empresa}</p>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              Papel: {PAPEL[c.papel] ?? c.papel} · {c.permissoes.length} permissões
            </p>
            {revisando === c.id ? (
              <>
                <p className="mb-2 text-sm font-medium">Você vai receber estas permissões:</p>
                <ul className="mb-4 max-h-60 list-disc overflow-y-auto pl-5 text-sm">
                  {c.permissoes.map((p) => {
                    const [modulo, acao] = p.split(':')
                    return (
                      <li key={p}>
                        {modulo}: {rotuloAcao(acao)}
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Botao onClick={() => void aceitar(c)}>Confirmar aceite</Botao>
                  <Botao variante="secundario" onClick={() => setRevisando(null)}>
                    Voltar
                  </Botao>
                </div>
              </>
            ) : (
              <Botao onClick={() => setRevisando(c.id)}>Revisar e aceitar</Botao>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
