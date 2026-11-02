import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Aviso, Botao } from '../../components/ui'
import { supabase } from '../../lib/supabase'

type Sessao = { id: string; criada_em: string; atualizada_em: string | null; dispositivo: string | null; ip: string | null; atual: boolean }

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export function SessoesPage() {
  const navigate = useNavigate()
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const sessoes = useQuery({
    queryKey: ['minhas-sessoes'],
    queryFn: async () => {
      const { data: linhas, error } = await supabase.schema('core').rpc('minhas_sessoes')
      if (error) throw error
      return linhas as Sessao[]
    },
  })

  // Só confirma o encerramento se o servidor confirmou (T5: não dar falsa sensação de segurança).
  async function sairDasOutras() {
    setAviso(null)
    setErro(null)
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    if (error) {
      setErro('Não foi possível encerrar as outras sessões. Verifique a conexão e tente de novo.')
      return
    }
    setAviso('As outras sessões foram encerradas.')
    await sessoes.refetch()
  }

  async function sairDeTodas() {
    setAviso(null)
    setErro(null)
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      setErro('Não foi possível encerrar as sessões no servidor. Verifique a conexão e tente de novo.')
      return
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <Link to="/" className="text-sm text-marca underline dark:text-sky-300">
        ← Início
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Sessões ativas</h1>
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sessoes.isError && <Aviso tipo="erro">Não foi possível carregar as sessões.</Aviso>}
      <ul className="mb-6 space-y-2">
        {sessoes.data?.map((s) => (
          <li key={s.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="font-medium">
              {s.dispositivo ?? 'Dispositivo desconhecido'}
              {s.atual && <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">esta sessão</span>}
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              Desde {data.format(new Date(s.criada_em))}
              {s.atualizada_em ? ` · último uso ${data.format(new Date(s.atualizada_em))}` : ''}
              {s.ip ? ` · IP ${s.ip}` : ''}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Botao variante="secundario" onClick={sairDasOutras}>
          Sair das outras sessões
        </Botao>
        <Botao variante="perigo" onClick={sairDeTodas}>
          Sair de todos os dispositivos
        </Botao>
      </div>
    </div>
  )
}
