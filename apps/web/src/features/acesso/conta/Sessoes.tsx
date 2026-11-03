import { useEffect, useState } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao } from '../../../ui'
import { Secao } from './Secao'
import { useEnvio } from './useEnvio'

interface SessaoAberta {
  id: string
  plataforma: string
  user_agent: string | null
  ip: string | null
  ultimo_uso_em: string
  atual: boolean
}

const listar = () => chamar<SessaoAberta[]>('GET', '/auth/sessoes')

// Sessões abertas da própria conta (as de outras pessoas a API nem lista). Ao abrir a tela já vem
// atualizada (troca de senha ou de autenticador encerra outras sessões).
export function Sessoes() {
  const [sessoes, setSessoes] = useState<SessaoAberta[]>([])
  const { enviando, erro, ok, enviar } = useEnvio()

  useEffect(() => {
    let vivo = true
    listar()
      .then((l) => vivo && setSessoes(l))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  const encerrar = (id: string) =>
    enviar(async () => {
      await chamar('DELETE', `/auth/sessoes/${id}`)
      setSessoes(await listar())
      return 'Sessão encerrada.'
    })

  const encerrarOutras = () =>
    enviar(async () => {
      const r = await chamar<{ encerradas: number }>('POST', '/auth/logout-todas', { manterAtual: true })
      setSessoes(await listar())
      return `${r.encerradas} sessão(ões) encerrada(s).`
    })

  return (
    <Secao titulo="Sessões abertas">
      <div className="pilha">
        {sessoes.map((s) => (
          <div key={s.id} className="pilha" style={{ gap: 2, paddingBottom: 'var(--e2)', borderBottom: '1px solid var(--linha)' }}>
            <strong>
              {s.plataforma}
              {s.atual ? ' · esta sessão' : ''}
            </strong>
            <span className="legenda" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[s.ip, s.user_agent].filter(Boolean).join(' · ')}
            </span>
            <span className="legenda">Último uso: {new Date(s.ultimo_uso_em).toLocaleString('pt-BR')}</span>
            {!s.atual ? (
              <div>
                <Botao variante="secundario" onClick={() => void encerrar(s.id)}>
                  Encerrar
                </Botao>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {sessoes.length > 1 ? (
        <Botao onClick={() => void encerrarOutras()} carregando={enviando}>
          Encerrar as outras sessões
        </Botao>
      ) : null}
    </Secao>
  )
}
