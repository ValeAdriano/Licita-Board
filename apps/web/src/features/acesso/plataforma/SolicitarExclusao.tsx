import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { AreaTexto, Aviso, Botao } from '../../../ui'
import { cnpjLegivel } from '../cnpj'
import { StepUpModal } from '../equipe/StepUpModal'
import type { EmpresaPlataforma } from './tipos'

// Exclusão definitiva (Prompt 1.3): só SUPERADMIN, com motivo, MFA recente e a aprovação de OUTRO
// SUPERADMIN em até 72 h. Aqui só se PEDE; nada é apagado até a segunda pessoa aprovar.
export function SolicitarExclusao(props: { empresa: EmpresaPlataforma; aoConcluir: () => void; aoCancelar: () => void }) {
  const { empresa } = props
  const [motivo, setMotivo] = useState('')
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  function revisar(e: FormEvent) {
    e.preventDefault()
    const m = motivo.trim()
    if (m.length < 10) return setErro('Explique o motivo em pelo menos 10 caracteres.')
    setErro(null)
    setConfirmando(m)
  }

  async function enviar(stepUp: string) {
    if (!confirmando) return
    try {
      await chamar('POST', '/exclusoes', { tabela: 'core.empresas', id: empresa.id, motivo: confirmando, stepUp })
    } catch (e) {
      setConfirmando(null)
      setErro(`${e instanceof ErroApi ? e.message : 'Não foi possível pedir a exclusão.'} O código já foi usado: aguarde o próximo para tentar de novo.`)
      return
    }
    setConfirmando(null)
    props.aoConcluir()
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={revisar} noValidate>
      <h2>Excluir definitivamente</h2>
      <div className="flex flex-col gap-0.5 rounded-lg bg-secondary px-3 py-2 text-sm font-semibold text-primary">
        <span>
          <bdi>{empresa.razaoSocial}</bdi>
        </span>
        <span>CNPJ {cnpjLegivel(empresa.cnpj)}</span>
      </div>
      <p>
        Isso apaga a empresa e tudo que é dela, <strong>sem volta</strong>. Outro SUPERADMIN precisa aprovar em até 72 horas; até lá nada é apagado.
      </p>
      <AreaTexto rotulo="Motivo" rows={4} value={motivo} onChange={setMotivo} maxLength={2000} />
      <Aviso texto={erro} />
      <Botao type="submit" variante="perigo" cheio>
        Pedir exclusão
      </Botao>
      <Botao variante="texto" onClick={props.aoCancelar}>
        Cancelar
      </Botao>
      <StepUpModal
        aberto={confirmando !== null}
        escopo="exclusao_definitiva"
        descricao="Pedir a exclusão definitiva é uma operação crítica. Confira o resumo e digite o código do autenticador."
        resumo={[`Empresa: ${empresa.razaoSocial}`, `CNPJ ${cnpjLegivel(empresa.cnpj)}`, `Motivo: ${confirmando ?? ''}`]}
        aoConfirmar={enviar}
        aoCancelar={() => setConfirmando(null)}
      />
    </form>
  )
}
