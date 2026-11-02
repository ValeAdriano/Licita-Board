import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Aviso } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { supabase } from '../../lib/supabase'

const PAPEL: Record<string, string> = {
  ADMIN_EMPRESA: 'Administrador',
  OPERADOR: 'Operador',
  JURIDICO: 'Jurídico',
  CLIENTE: 'Cliente',
}

type Vinculo = { id: string; papel: string; empresas: { razao_social: string; nome_fantasia: string | null } | null }

export function InicioPage() {
  const { session, perfil } = useAuth()
  const vinculos = useQuery({
    queryKey: ['meus-vinculos', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('core')
        .from('vinculos')
        .select('id, papel, empresas(razao_social, nome_fantasia)')
        .eq('usuario_id', session?.user.id ?? '')
        .eq('ativo', true)
        .is('deleted_at', null)
      if (error) throw error
      return data as unknown as Vinculo[]
    },
  })

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-2xl font-semibold">Olá{perfil?.nome ? `, ${perfil.nome}` : ''}</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        {perfil?.superadmin ? 'SUPERADMIN · ' : ''}
        {session?.user.email}
      </p>

      <h2 className="mb-2 text-lg font-semibold">Suas empresas</h2>
      {vinculos.isPending && <p className="text-sm">Carregando…</p>}
      {vinculos.isError && <Aviso tipo="erro">Não foi possível carregar suas empresas.</Aviso>}
      {vinculos.data?.length === 0 && <Aviso>Você ainda não tem acesso a nenhuma empresa. Fale com o administrador.</Aviso>}
      <ul className="mb-6 space-y-2">
        {vinculos.data?.map((v) => (
          <li key={v.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="font-medium">{v.empresas?.nome_fantasia || v.empresas?.razao_social || 'Empresa sem acesso de leitura'}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{PAPEL[v.papel] ?? v.papel}</p>
          </li>
        ))}
      </ul>

      <Aviso>
        Agenda, documentos, oportunidades e demais módulos: <strong>EM DESENVOLVIMENTO</strong>.
      </Aviso>
      <Link to="/conta/sessoes" className="text-sm text-marca underline dark:text-sky-300">
        Sessões ativas e segurança da conta
      </Link>
    </div>
  )
}
