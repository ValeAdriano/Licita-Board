import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { Aviso, Botao, Campo, Card, TelaCentral } from '../../components/ui'
import { supabase } from '../../lib/supabase'

const schema = z.object({ email: z.email('Informe um e-mail válido.') })
type Dados = z.infer<typeof schema>

// Mensagem sempre igual, exista ou não o e-mail (Prompt 1.4: não revelar cadastro).
export const MENSAGEM_RECUPERACAO =
  'Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha. O link vale por 30 minutos.'

export function RecuperarSenhaPage() {
  const [enviado, setEnviado] = useState(false)
  const form = useForm<Dados>({ resolver: zodResolver(schema) })

  const enviar = form.handleSubmit(async ({ email }) => {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/redefinir-senha` })
    setEnviado(true)
  })

  return (
    <TelaCentral>
      <Card titulo="Recuperar senha">
        {enviado ? (
          <Aviso tipo="sucesso">{MENSAGEM_RECUPERACAO}</Aviso>
        ) : (
          <form onSubmit={enviar} noValidate>
            <Campo rotulo="E-mail" type="email" autoComplete="username" {...form.register('email')} erro={form.formState.errors.email?.message} />
            <Botao type="submit" disabled={form.formState.isSubmitting}>
              Enviar link
            </Botao>
          </form>
        )}
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-marca underline dark:text-sky-300">
            Voltar para o login
          </Link>
        </p>
      </Card>
    </TelaCentral>
  )
}
