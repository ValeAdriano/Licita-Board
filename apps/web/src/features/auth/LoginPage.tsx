import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Aviso, Botao, Campo, Card, Carregando, TelaCentral } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { MENSAGEM_LOGIN_INVALIDO, mensagemDeErro } from '../../lib/auth/erros'
import { marcarAtividade } from '../../lib/auth/inatividade'
import { supabase } from '../../lib/supabase'
import { ROTA_DE } from '../../app/rotas'

const schema = z.object({
  email: z.email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe a senha.'),
})
type Dados = z.infer<typeof schema>

export function LoginPage() {
  const { carregando, destino } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [erro, setErro] = useState<string | null>(null)
  const form = useForm<Dados>({ resolver: zodResolver(schema) })

  if (carregando) return <Carregando />
  if (destino !== 'login') return <Navigate to={ROTA_DE[destino]} replace />

  const entrar = form.handleSubmit(async ({ email, senha }) => {
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      // Qualquer falha que não seja limite de tentativas recebe a mesma mensagem neutra.
      setErro(error.status === 429 ? mensagemDeErro(error) : MENSAGEM_LOGIN_INVALIDO)
      return
    }
    marcarAtividade()
    navigate('/', { replace: true })
  })

  return (
    <TelaCentral>
      <Card titulo="Entrar no VV Licitações">
        {params.get('motivo') === 'inatividade' && (
          <Aviso>Você foi desconectado após 30 minutos sem atividade.</Aviso>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <form onSubmit={entrar} noValidate>
          <Campo rotulo="E-mail" type="email" autoComplete="username" {...form.register('email')} erro={form.formState.errors.email?.message} />
          <Campo rotulo="Senha" type="password" autoComplete="current-password" {...form.register('senha')} erro={form.formState.errors.senha?.message} />
          <Botao type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/recuperar-senha" className="text-marca underline dark:text-sky-300">
            Esqueci minha senha
          </Link>
        </p>
      </Card>
    </TelaCentral>
  )
}
