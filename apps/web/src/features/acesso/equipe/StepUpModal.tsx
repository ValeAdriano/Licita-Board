import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ErroApi } from '../../../api/cliente'
import { useSessao, type EscopoStepUp } from '../../../auth/sessao'
import { Aviso, Botao, Campo, Modal } from '../../../ui'

// Confirmação de operação crítica (spec §6 regra 10): código NOVO do autenticador, que vira uma
// credencial de uso único (5 min) para o escopo. O front só repassa; quem confere é a API/banco.
// Cada código errado ou repetido conta como erro de MFA (5 encerram a sessão): por isso um envio
// por vez, o mesmo código nunca é reenviado e "Cancelar" vale também para o envio em andamento.
export function StepUpModal(props: {
  aberto: boolean
  escopo: EscopoStepUp
  descricao: string
  resumo: string[]
  aoConfirmar: (stepUp: string) => Promise<void>
  aoCancelar: () => void
}) {
  const { aberto, escopo, descricao, resumo, aoConfirmar, aoCancelar } = props
  const { stepUp } = useSessao()
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const emVoo = useRef(false)
  const geracao = useRef(0)
  // Depois que o código foi aceito a operação já está em andamento: "Cancelar" deixa de valer.
  const [confirmado, setConfirmado] = useState(false)
  const confirmadoRef = useRef(false)
  // Tela desmontada durante a conferência do código: a operação crítica não segue.
  useEffect(() => {
    const g = geracao
    return () => {
      g.current += 1
    }
  }, [])
  const ultimoUsado = useRef<string | null>(null)

  async function confirmar(e?: FormEvent) {
    e?.preventDefault()
    if (emVoo.current) return
    const c = codigo.trim()
    if (!/^\d{6}$/.test(c)) return setErro('Informe o código de 6 dígitos do autenticador.')
    if (c === ultimoUsado.current) return setErro('Esse código já foi usado. Aguarde o próximo código do autenticador.')
    emVoo.current = true
    setEnviando(true)
    setErro(null)
    const minha = geracao.current
    try {
      ultimoUsado.current = c
      const id = await stepUp(escopo, c)
      setCodigo('')
      // Cancelou (ou saiu da tela) enquanto o código era conferido: a operação crítica não segue.
      if (minha === geracao.current) {
        confirmadoRef.current = true
        setConfirmado(true)
        await aoConfirmar(id)
      }
    } catch (e) {
      if (minha !== geracao.current) return
      if (e instanceof ErroApi && e.status === 403) {
        setErro('Não foi possível autorizar agora. Confira se o autenticador está ativo há mais de 24 horas e tente de novo.')
      } else {
        setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
      }
    } finally {
      emVoo.current = false
      confirmadoRef.current = false
      setConfirmado(false)
      setEnviando(false)
    }
  }

  function cancelar() {
    if (confirmadoRef.current) return
    geracao.current += 1
    setCodigo('')
    setErro(null)
    aoCancelar()
  }

  return (
    <Modal aberto={aberto} titulo="Confirmar operação crítica" aoFechar={cancelar}>
      <form className="pilha" onSubmit={(e) => void confirmar(e)} noValidate>
        <p>{descricao}</p>
        <div className="modal__resumo">
          {resumo.map((linha) => (
            <span key={linha}>{linha}</span>
          ))}
        </div>
        <Campo rotulo="Código do autenticador" value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        <Aviso texto={erro} />
        <Botao type="submit" carregando={enviando}>
          Confirmar
        </Botao>
        <Botao variante="texto" onClick={cancelar} disabled={confirmado}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  )
}
