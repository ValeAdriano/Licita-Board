import { chamar } from '../api/cliente'

// Web Push no navegador (ADR-018). O servidor só recebe a inscrição; o texto do push é genérico e o
// conteúdo da notificação continua passando pela API (sessão, permissão, RLS).
export type EstadoPush =
  | 'sem_suporte' // navegador sem service worker, push ou Notification
  | 'instalar' // iPhone/iPad: só funciona com o app instalado na tela inicial
  | 'sem_service_worker' // dev ou build ainda sem service worker ativo
  | 'indisponivel' // servidor sem chave VAPID (push desligado)
  | 'negado' // o usuário bloqueou as notificações no navegador
  | 'desligado'
  | 'ligado'

export function urlBase64ParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const preenchido = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const bruto = atob(preenchido)
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length))
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
  return bytes
}

const suportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const ehIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const instalado = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

async function inscricaoAtual(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const registro = await navigator.serviceWorker.getRegistration()
  return registro ? registro.pushManager.getSubscription() : null
}

function mesmaChave(atual: ArrayBuffer | null, esperada: Uint8Array): boolean {
  if (!atual) return false
  const a = new Uint8Array(atual)
  return a.length === esperada.length && a.every((v, i) => v === esperada[i])
}

// Em que pé está o push neste navegador (sem pedir permissão nem inscrever nada).
export async function estadoPush(): Promise<EstadoPush> {
  if (ehIos() && !instalado()) return 'instalar'
  if (!suportado()) return 'sem_suporte'
  if (Notification.permission === 'denied') return 'negado'
  const registro = await navigator.serviceWorker.getRegistration()
  if (!registro) return 'sem_service_worker'
  try {
    await chamar('GET', '/push/chave')
  } catch {
    return 'indisponivel'
  }
  const inscricao = await registro.pushManager.getSubscription()
  if (!inscricao) return 'desligado'
  const { id } = await chamar<{ id: string | null }>('POST', '/dispositivos-push/consulta', { endpoint: inscricao.endpoint })
  return id ? 'ligado' : 'desligado'
}

// Pede permissão (só por clique do usuário), inscreve e registra o dispositivo na API.
export async function ativarPush(): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Permissão para notificações negada.')
  const registro = await navigator.serviceWorker.getRegistration()
  if (!registro) throw new Error('O app ainda não está pronto para receber alertas. Recarregue a página.')
  const { chave } = await chamar<{ chave: string }>('GET', '/push/chave')
  const esperada = urlBase64ParaBytes(chave)
  let inscricao = await registro.pushManager.getSubscription()
  // Inscrição criada com outra chave VAPID (chave rotacionada) receberia 403 para sempre: refaz.
  if (inscricao && !mesmaChave(inscricao.options.applicationServerKey, esperada)) {
    await inscricao.unsubscribe()
    inscricao = null
  }
  inscricao ??= await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: esperada })
  const { endpoint, keys } = inscricao.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('Inscrição inválida.')
  await chamar('POST', '/dispositivos-push', { endpoint, chaves: { p256dh: keys.p256dh, auth: keys.auth } })
}

// Desliga neste navegador: revoga no servidor e cancela a inscrição local.
export async function desativarPush(): Promise<void> {
  const inscricao = await inscricaoAtual()
  if (!inscricao) return
  await chamar('POST', '/dispositivos-push/revogar', { endpoint: inscricao.endpoint })
  await inscricao.unsubscribe()
}

// Logout: o próximo usuário deste navegador não pode receber os alertas do anterior (T5.26). Melhor
// esforço e sem lançar erro: a inscrição local é cancelada mesmo que o servidor não responda (o
// serviço de push responde 410 e o worker revoga).
export async function cancelarPushAoSair(servidorAtivo: boolean): Promise<void> {
  try {
    const inscricao = await inscricaoAtual()
    if (!inscricao) return
    if (servidorAtivo) await chamar('POST', '/dispositivos-push/revogar', { endpoint: inscricao.endpoint }).catch(() => {})
    await inscricao.unsubscribe()
  } catch {
    // sem suporte ou sem service worker: nada a cancelar
  }
}
