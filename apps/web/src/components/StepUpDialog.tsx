import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth/AuthProvider'
import { type EscopoStepUp, obterStepUp } from '../lib/stepUp'
import { CodigoMfa } from './CodigoMfa'

type Props = {
  aberto: boolean
  escopo: EscopoStepUp
  descricao: string
  /** Recebe o token; devolve mensagem de erro da operação ou null em caso de sucesso. */
  aoConfirmar: (token: string) => Promise<string | null>
  aoCancelar: () => void
}

// Modal de reautenticação antes de operação crítica. Renderizado em portal (fora de qualquer <form>)
// e aberto com showModal(): fundo bloqueado, foco preso, Esc cancela. Cancelar fica desabilitado
// enquanto a operação está em andamento (não dá para "cancelar" algo que já foi enviado).
export function StepUpDialog({ aberto, escopo, descricao, aoConfirmar, aoCancelar }: Props) {
  const { fatorVerificadoId } = useAuth()
  const ref = useRef<HTMLDialogElement>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d || !aberto) return
    if (typeof d.showModal === 'function') {
      if (!d.open) d.showModal()
    } else {
      d.setAttribute('open', '')
    }
    return () => {
      if (d.open && typeof d.close === 'function') d.close()
    }
  }, [aberto])

  if (!aberto) return null
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="stepup-titulo"
      onCancel={(e) => {
        e.preventDefault()
        if (!enviando) aoCancelar()
      }}
      className="fixed inset-x-0 bottom-0 m-0 w-full max-w-none rounded-t-2xl border-0 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/40 sm:inset-auto sm:m-auto sm:max-w-md sm:rounded-2xl dark:bg-slate-900 dark:text-slate-100"
    >
      <h2 id="stepup-titulo" className="mb-2 text-lg font-semibold">
        Confirme sua identidade
      </h2>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{descricao}</p>
      <CodigoMfa
        rotuloBotao="Confirmar"
        aoEnviar={async (codigo) => {
          if (!fatorVerificadoId) return 'Cadastre um autenticador para fazer esta operação.'
          setEnviando(true)
          try {
            const r = await obterStepUp(fatorVerificadoId, codigo, escopo)
            if (r.erro !== undefined) return r.erro
            return await aoConfirmar(r.token)
          } finally {
            setEnviando(false)
          }
        }}
      />
      <button type="button" onClick={aoCancelar} disabled={enviando} className="mt-3 min-h-11 w-full text-sm underline disabled:opacity-50">
        Cancelar
      </button>
    </dialog>,
    document.body,
  )
}
