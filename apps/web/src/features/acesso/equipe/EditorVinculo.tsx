import { useState } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Interruptor } from '../../../ui'
import { useAcesso } from '../contexto'
import { concessoesSensiveis, filtrarPorPapel, iguais, resumoMudanca, rotuloPapel, sugestaoPorPapel, type Modulo, type Papel } from '../matriz'
import { MatrizEditavel } from './MatrizEditavel'
import { SeletorPapel } from './SeletorPapel'
import { StepUpModal } from './StepUpModal'
import type { Membro } from './tipos'

interface Pendente {
  papel: Papel
  ativo: boolean
  permissoes: string[]
}

// Edita papel, situação e permissões de um vínculo. Salvar é operação crítica: pede step-up e o que
// será gravado é congelado ao abrir a confirmação (mudança na tela depois disso não entra).
export function EditorVinculo(props: { membro: Membro; modulos: Modulo[]; podeAdministrar: boolean; aoSalvar: () => void; aoFechar: () => void }) {
  const { membro, modulos, podeAdministrar, aoSalvar, aoFechar } = props
  const { recarregar, pode } = useAcesso()
  const original = new Set(membro.permissoes)
  const [papel, setPapel] = useState<Papel>(membro.papel)
  const [ativo, setAtivo] = useState(membro.ativo)
  const [selecao, setSelecao] = useState<Set<string>>(original)
  const [pendente, setPendente] = useState<Pendente | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const alterado = papel !== membro.papel || ativo !== membro.ativo || !iguais(selecao, original)

  const trocarPapel = (novo: Papel) => {
    setPapel(novo)
    setSelecao((s) => filtrarPorPapel(novo, s))
  }

  async function salvar(stepUp: string) {
    if (!pendente) return
    try {
      await chamar('PUT', `/vinculos/${membro.vinculoId}`, { ...pendente, stepUp })
    } catch (e) {
      setPendente(null)
      setOk(null)
      // O código do autenticador já foi usado: um novo envio exige o próximo código.
      const motivo = e instanceof ErroApi ? e.message : 'Não foi possível salvar. Recarregue e tente de novo.'
      setErro(`${motivo} O código já foi usado: aguarde o próximo código do autenticador para tentar de novo.`)
      if (e instanceof ErroApi && e.status === 0) aoSalvar() // pode ter gravado: confere a lista
      return
    }
    setPendente(null)
    setErro(null)
    setOk('Permissões salvas.')
    aoSalvar()
    void recarregar().catch(() => {}) // as próprias permissões podem ter mudado
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2>{membro.nome || membro.email}</h2>
          <p className="text-sm text-tertiary [overflow-wrap:anywhere]">{membro.email}</p>
        </div>
        <Botao variante="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {!podeAdministrar ? <Aviso tipo="atencao" texto="Você pode ver estas permissões, mas não alterá-las." /> : null}

      <div className="flex flex-col gap-4">
        <h3>Papel</h3>
        <SeletorPapel papel={papel} aoMudar={trocarPapel} desabilitado={!podeAdministrar} />
        <Interruptor rotulo="Acesso ativo" marcado={ativo} aoMudar={setAtivo} desabilitado={!podeAdministrar} />
        {podeAdministrar ? (
          <div>
            <Botao variante="secundario" onClick={() => setSelecao(sugestaoPorPapel(papel, modulos))}>
              Aplicar sugestão do papel (revise antes de salvar)
            </Botao>
          </div>
        ) : null}
      </div>

      <MatrizEditavel modulos={modulos} papel={papel} selecao={selecao} aoMudar={setSelecao} somenteLeitura={!podeAdministrar} podeConceder={pode} />

      {podeAdministrar ? (
        <Botao cheio onClick={() => alterado && setPendente({ papel, ativo, permissoes: [...selecao].sort() })} disabled={!alterado}>
          Salvar alterações
        </Botao>
      ) : null}

      <StepUpModal
        aberto={pendente !== null}
        escopo="alterar_permissoes"
        descricao="Alterar permissões é uma operação crítica. Confira o resumo e digite o código do autenticador."
        resumo={
          pendente
            ? [
                `Alterar: ${membro.nome || membro.email}`,
                `Papel: ${rotuloPapel(pendente.papel)} · acesso ${pendente.ativo ? 'ativo' : 'inativo'}`,
                ...resumoMudanca(original, new Set(pendente.permissoes)),
                ...concessoesSensiveis(original, new Set(pendente.permissoes), modulos),
              ]
            : []
        }
        aoConfirmar={salvar}
        aoCancelar={() => setPendente(null)}
      />
    </div>
  )
}
