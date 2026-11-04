import { useEffect, useState } from 'react'
import { Aviso, Botao } from '../../../ui'
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from '../../../push/push'
import { Secao } from './Secao'
import { useEnvio } from './useEnvio'

const TEXTOS: Record<Exclude<EstadoPush, 'desligado' | 'ligado'>, string> = {
  sem_suporte: 'Este navegador não recebe alertas fora da página.',
  instalar: 'No iPhone e no iPad, instale o app na tela inicial (Compartilhar › Adicionar à Tela de Início) e abra por lá para ligar os alertas.',
  sem_service_worker: 'Os alertas ficam disponíveis no app instalado ou na versão publicada (não no modo de desenvolvimento).',
  indisponivel: 'Os alertas no dispositivo ainda não estão ativos neste servidor.',
  negado: 'As notificações estão bloqueadas neste navegador. Libere nas configurações do site para ligar os alertas.',
}

// Alertas no dispositivo (Web Push, ADR-018): o aviso é genérico ("você tem uma nova notificação"); o
// conteúdo só aparece dentro do app, depois do login. Só liga por clique; sair da conta desliga.
export function Alertas() {
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  const { enviando, erro, ok, enviar } = useEnvio()

  useEffect(() => {
    let vivo = true
    estadoPush()
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado('sem_suporte'))
    return () => {
      vivo = false
    }
  }, [])

  const trocar = (acao: () => Promise<void>, mensagem: string) =>
    enviar(async () => {
      await acao()
      setEstado(await estadoPush())
      return mensagem
    })

  return (
    <Secao titulo="Alertas neste dispositivo">
      {estado === null ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Verificando…</p> : null}
      {estado !== null && estado !== 'ligado' && estado !== 'desligado' ? <Aviso tipo="atencao" texto={TEXTOS[estado]} /> : null}
      {estado === 'desligado' ? (
        <div className="flex flex-col gap-4">
          <p>Receba um aviso neste dispositivo quando houver uma nova notificação. O aviso não mostra o conteúdo.</p>
          <Botao carregando={enviando} onClick={() => void trocar(ativarPush, 'Alertas ligados neste dispositivo.')}>
            Ligar alertas
          </Botao>
        </div>
      ) : null}
      {estado === 'ligado' ? (
        <div className="flex flex-col gap-4">
          <p>Alertas ligados neste dispositivo. Sair da conta desliga os alertas deste navegador; trocar a senha desliga em todos.</p>
          <Botao variante="secundario" carregando={enviando} onClick={() => void trocar(desativarPush, 'Alertas desligados neste dispositivo.')}>
            Desligar alertas
          </Botao>
        </div>
      ) : null}
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
    </Secao>
  )
}
