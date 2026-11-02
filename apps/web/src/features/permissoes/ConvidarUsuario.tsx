import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { StepUpDialog } from '../../components/StepUpDialog'
import { Aviso, Botao, Campo } from '../../components/ui'
import { filtrarPorPapel, type Modulo, type Papel, PAPEIS, sugestaoPorPapel } from '../../lib/permissoes/matriz'
import { mensagemBloqueioPermissao } from '../../lib/stepUp'
import { supabase } from '../../lib/supabase'
import { MatrizEditavel } from './MatrizEditavel'

const schema = z.object({ email: z.email('Informe um e-mail válido.') })

type Props = { empresaId: string; modulos: Modulo[]; aoConcluir: () => void }

export function ConvidarUsuario({ empresaId, modulos, aoConcluir }: Props) {
  const queryClient = useQueryClient()
  const form = useForm<{ email: string }>({ resolver: zodResolver(schema) })
  const [papel, setPapel] = useState<Papel>('OPERADOR')
  const [selecao, setSelecao] = useState(() => sugestaoPorPapel('OPERADOR', modulos))
  // Congelado ao abrir a confirmação (e-mail, papel e permissões).
  const [pendente, setPendente] = useState<{ email: string; papel: Papel; permissoes: string[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<string | null>(null)

  function trocarPapel(novo: Papel) {
    setPapel(novo)
    setSelecao(filtrarPorPapel(novo, sugestaoPorPapel(novo, modulos)))
  }

  async function convidar(token: string): Promise<string | null> {
    if (!pendente) return 'Nada para enviar.'
    const { error } = await supabase.schema('core').rpc('convidar_usuario', {
      p_empresa: empresaId,
      p_email: pendente.email,
      p_papel: pendente.papel,
      p_permissoes: pendente.permissoes,
      p_step_up: token,
    })
    setPendente(null)
    if (error) {
      setErro(
        error.code === '23505'
          ? 'Já existe convite pendente ou vínculo para este e-mail nesta empresa.'
          : (mensagemBloqueioPermissao(error.message) ?? 'Não foi possível enviar o convite. Tente de novo.'),
      )
      return null
    }
    setEnviado(pendente.email)
    await queryClient.invalidateQueries({ queryKey: ['convites', empresaId] })
    return null
  }

  if (enviado) {
    return (
      <div>
        <Aviso tipo="sucesso">
          Convite registrado para {enviado}. Se a pessoa já tiver conta, verá o convite ao entrar; caso contrário, peça ao
          SUPERADMIN para criar o acesso (envio automático por e-mail: EM DESENVOLVIMENTO).
        </Aviso>
        <Botao variante="secundario" onClick={aoConcluir}>
          Concluir
        </Botao>
      </div>
    )
  }

  return (
    <form
      onSubmit={form.handleSubmit(({ email: e }) => {
        setErro(null)
        setPendente({ email: e, papel, permissoes: [...selecao].sort() })
      })}
      noValidate
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="E-mail da pessoa" type="email" autoComplete="off" {...form.register('email')} erro={form.formState.errors.email?.message} />
      <label className="mb-4 block text-sm">
        <span className="mb-1 block font-medium">Papel</span>
        <select
          value={papel}
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
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">Permissões sugeridas para o papel. Revise antes de enviar.</p>
      <MatrizEditavel modulos={modulos} papel={papel} selecao={selecao} aoMudar={setSelecao} />
      <div className="mt-4">
        <Botao type="submit">Enviar convite</Botao>
      </div>
      <StepUpDialog
        aberto={pendente !== null}
        escopo="alterar_permissoes"
        descricao="Convidar alguém dá acesso à empresa. Digite o código do autenticador para confirmar."
        aoConfirmar={convidar}
        aoCancelar={() => setPendente(null)}
      />
    </form>
  )
}
