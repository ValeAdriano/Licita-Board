import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { Aviso, Botao, Campo } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { supabase } from '../../lib/supabase'

const schema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome.').max(200),
  telefone: z.string().trim().max(30, 'Telefone muito longo.').optional(),
})
type Dados = z.infer<typeof schema>

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

// Configurações da conta (Prompt 1.1). Só nome e telefone são editáveis pelo usuário (grant por coluna).
export function ContaPage() {
  const { session, perfil } = useAuth()
  const queryClient = useQueryClient()
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const usuarioId = session?.user.id ?? ''

  const atual = useQuery({
    queryKey: ['meu-perfil', usuarioId],
    queryFn: async () => {
      const { data: linha, error } = await supabase.schema('core').from('usuarios').select('nome, telefone').eq('id', usuarioId).single()
      if (error) throw error
      return linha as { nome: string | null; telefone: string | null }
    },
  })
  const fatores = useQuery({
    queryKey: ['meus-fatores', usuarioId],
    queryFn: async () => {
      const { data: f, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      return f.totp
    },
  })

  const form = useForm<Dados>({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (atual.data) form.reset({ nome: atual.data.nome ?? '', telefone: atual.data.telefone ?? '' })
  }, [atual.data, form])

  const salvar = form.handleSubmit(async ({ nome, telefone }) => {
    setSalvo(false)
    setErro(null)
    const { error } = await supabase
      .schema('core')
      .from('usuarios')
      .update({ nome, telefone: telefone || null })
      .eq('id', usuarioId)
    if (error) {
      setErro('Não foi possível salvar. Tente de novo.')
      return
    }
    setSalvo(true)
    await queryClient.invalidateQueries({ queryKey: ['acesso'] })
  })

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-2xl font-semibold">Minha conta</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        {session?.user.email}
        {perfil?.superadmin ? ' · SUPERADMIN' : ''}
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Dados pessoais</h2>
        {salvo && <Aviso tipo="sucesso">Dados salvos.</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <form onSubmit={salvar} noValidate className="max-w-md">
          <Campo rotulo="Nome" autoComplete="name" {...form.register('nome')} erro={form.formState.errors.nome?.message} />
          <Campo rotulo="Telefone" type="tel" autoComplete="tel" {...form.register('telefone')} erro={form.formState.errors.telefone?.message} />
          <Botao type="submit" disabled={form.formState.isSubmitting || atual.isPending}>
            Salvar
          </Botao>
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Verificação em duas etapas</h2>
        {fatores.data?.length ? (
          <ul className="space-y-2 text-sm">
            {fatores.data.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                {f.friendly_name || 'Autenticador'} · ativo desde {data.format(new Date(f.created_at))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">Nenhum autenticador cadastrado.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Segurança</h2>
        <Link to="/conta/sessoes" className="text-sm text-marca underline dark:text-sky-300">
          Sessões ativas e sair de outros dispositivos
        </Link>
      </section>
    </div>
  )
}
