import { useRef, useState, type ReactNode } from 'react'
import { ErroApi } from '../../api/cliente'
import type { EscopoStepUp } from '../../auth/sessao'
import { StepUpModal } from './equipe/StepUpModal'

// Aprovações críticas (peça, proposta final, preço abaixo do mínimo) pedem reautenticação com o código do autenticador. O front tenta primeiro
// sem credencial: quem não tem autenticador (chave de desenvolvimento, ADR-021) aprova direto; se a API responder 403 (exige o código), abre o
// modal, troca o código por um token de uso único e repete a chamada com ele. Quem confere o token é o banco.
export function useReautenticacao(escopo: EscopoStepUp, descricao: string, resumo: string[]) {
  const [pedindo, setPedindo] = useState(false)
  const pendente = useRef<((stepUp: string | null) => Promise<void>) | null>(null)

  async function executar(chamada: (stepUp: string | null) => Promise<void>): Promise<void> {
    try {
      await chamada(null)
    } catch (e) {
      if (e instanceof ErroApi && e.status === 403) {
        pendente.current = chamada
        setPedindo(true)
        return
      }
      throw e
    }
  }

  const modal: ReactNode = (
    <StepUpModal
      aberto={pedindo}
      escopo={escopo}
      descricao={descricao}
      resumo={resumo}
      aoCancelar={() => { pendente.current = null; setPedindo(false) }}
      aoConfirmar={async (stepUp) => {
        const chamada = pendente.current
        if (!chamada) return
        await chamada(stepUp)
        pendente.current = null
        setPedindo(false)
      }}
    />
  )
  return { executar, modal }
}
