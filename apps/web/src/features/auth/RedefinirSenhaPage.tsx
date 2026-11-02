import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { Aviso, Botao, Campo, Card, Carregando, TelaCentral } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { mensagemDeErro } from '../../lib/auth/erros'
import { type NovaSenha, novaSenhaSchema } from '../../lib/auth/senha'
import { supabase } from '../../lib/supabase'
import { CodigoMfa } from '../../components/CodigoMfa'

// Só funciona para a aba que chegou pelo link do e-mail (evento PASSWORD_RECOVERY): uma sessão
// comum aberta não troca a senha por aqui (T5.3). Quem tem autenticador confirma o código antes.
// Troca de senha estando logado (com a senha atual) fica para a tela de conta.
export function RedefinirSenhaPage() {
  const { carregando, session, destino, fatorVerificadoId, recarregar, emRecuperacao } = useAuth()
  const navigate = useNavigate()
  const [erro, setErro] = useState<string | null>(null)
  const form = useForm<NovaSenha>({ resolver: zodResolver(novaSenhaSchema) })

  if (carregando) return <Carregando />
  if (!session || !emRecuperacao) {
    return (
      <TelaCentral>
        <Card titulo="Link inválido ou expirado">
          <p className="mb-4 text-sm">Peça um novo link de recuperação.</p>
          <Link to="/recuperar-senha" className="text-marca underline dark:text-sky-300">
            Recuperar senha
          </Link>
        </Card>
      </TelaCentral>
    )
  }

  if (destino === 'verificar-mfa' && fatorVerificadoId) {
    return (
      <TelaCentral>
        <Card titulo="Confirme o autenticador">
          <p className="mb-4 text-sm">Para criar uma nova senha, digite o código do aplicativo autenticador.</p>
          <CodigoMfa
            aoEnviar={async (codigo) => {
              const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorVerificadoId, code: codigo })
              if (error) return mensagemDeErro(error)
              await recarregar()
              return null
            }}
          />
        </Card>
      </TelaCentral>
    )
  }

  const salvar = form.handleSubmit(async ({ senha }) => {
    setErro(null)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setErro(mensagemDeErro(error))
      return
    }
    const saida = await supabase.auth.signOut({ scope: 'others' })
    if (saida.error) {
      setErro('Senha alterada, mas não foi possível encerrar as outras sessões. Use "Sair de todos os dispositivos" em Sessões ativas.')
      return
    }
    navigate('/', { replace: true })
  })

  return (
    <TelaCentral>
      <Card titulo="Criar nova senha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Mínimo de 12 caracteres, com letra maiúscula, minúscula e número. As outras sessões serão encerradas.
        </p>
        <form onSubmit={salvar} noValidate>
          <Campo rotulo="Nova senha" type="password" autoComplete="new-password" {...form.register('senha')} erro={form.formState.errors.senha?.message} />
          <Campo rotulo="Confirme a nova senha" type="password" autoComplete="new-password" {...form.register('confirmacao')} erro={form.formState.errors.confirmacao?.message} />
          <Botao type="submit" disabled={form.formState.isSubmitting}>
            Salvar nova senha
          </Botao>
        </form>
      </Card>
    </TelaCentral>
  )
}
