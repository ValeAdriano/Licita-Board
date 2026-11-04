import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { useAcesso } from '../contexto'
import { concessoesSensiveis, filtrarPorPapel, rotuloPapel, sugestaoPorPapel, type Modulo, type Papel } from '../matriz'
import { MatrizEditavel } from './MatrizEditavel'
import { SeletorPapel } from './SeletorPapel'
import { StepUpModal } from './StepUpModal'

// Convite (spec §6 regra 13): preso à conta do convidado, vale 7 dias; a resposta da API é a mesma
// exista ou não a conta. Quem convida não pode dar mais do que tem (teto, conferido no banco).
export function ConvidarUsuario(props: { empresaId: string; modulos: Modulo[]; aoConcluir: () => void; aoCancelar: () => void }) {
  const { empresaId, modulos, aoConcluir, aoCancelar } = props
  const { pode } = useAcesso()
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>('OPERADOR')
  // Começa vazio: a sugestão do papel é ampla e só entra por escolha explícita de quem convida.
  const [selecao, setSelecao] = useState<Set<string>>(new Set())
  const [pendente, setPendente] = useState<{ email: string; papel: Papel; permissoes: string[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const trocarPapel = (novo: Papel) => {
    setPapel(novo)
    setSelecao((s) => filtrarPorPapel(novo, s))
  }

  function revisar(e: FormEvent) {
    e.preventDefault()
    const em = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setErro('Informe um e-mail válido.')
    setErro(null)
    setPendente({ email: em, papel, permissoes: [...filtrarPorPapel(papel, selecao)].sort() })
  }

  async function enviar(stepUp: string) {
    if (!pendente) return
    try {
      await chamar('POST', `/empresas/${empresaId}/convites`, { ...pendente, stepUp })
    } catch (e) {
      setPendente(null)
      const motivo = e instanceof ErroApi ? e.message : 'Não foi possível convidar. Tente de novo.'
      setErro(`${motivo} O código já foi usado: aguarde o próximo código do autenticador para tentar de novo.`)
      return
    }
    setPendente(null)
    aoConcluir()
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={revisar} noValidate>
      <h2>Convidar usuário</h2>
      <Campo rotulo="E-mail do convidado" type="email" value={email} onChange={(v) => setEmail(v)} autoComplete="off" inputMode="email" spellCheck={false} />
      <div className="flex flex-col gap-4">
        <h3>Papel</h3>
        <SeletorPapel papel={papel} aoMudar={trocarPapel} />
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">O convite vale por 7 dias e só pode ser aceito pela conta com este e-mail, já verificado.</p>
        <div>
          <Botao variante="secundario" onClick={() => setSelecao(filtrarPorPapel(papel, sugestaoPorPapel(papel, modulos)))}>
            Aplicar sugestão do papel (revise antes de enviar)
          </Botao>
        </div>
      </div>
      <MatrizEditavel modulos={modulos} papel={papel} selecao={selecao} aoMudar={setSelecao} somenteLeitura={false} podeConceder={pode} />
      <Aviso texto={erro} />
      <Botao type="submit" cheio>
        Enviar convite
      </Botao>
      <Botao variante="texto" onClick={aoCancelar}>
        Cancelar
      </Botao>
      <StepUpModal
        aberto={pendente !== null}
        escopo="alterar_permissoes"
        descricao="Convidar alguém concede acesso: é uma operação crítica. Confira o resumo e digite o código do autenticador."
        resumo={
          pendente
            ? [
                `Convidar: ${pendente.email}`,
                `Papel: ${rotuloPapel(pendente.papel)}`,
                `Permissões: ${pendente.permissoes.length}`,
                ...concessoesSensiveis(new Set(), new Set(pendente.permissoes), modulos),
              ]
            : []
        }
        aoConfirmar={enviar}
        aoCancelar={() => setPendente(null)}
      />
    </form>
  )
}
