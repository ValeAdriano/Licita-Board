import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { limparCredenciais } from '../api/cliente'
import { ativarPush, cancelarPushAoSair, desativarPush, estadoPush, urlBase64ParaBytes } from './push'

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response
}

const fetchMock = vi.fn()

interface Falsa {
  endpoint: string
  unsubscribe: ReturnType<typeof vi.fn>
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
}
const inscricao = (): Falsa => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  unsubscribe: vi.fn().mockResolvedValue(true),
  toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }),
})

function ambiente(opcoes: { ua?: string; permissao?: NotificationPermission; registro?: unknown; standalone?: boolean }) {
  vi.stubGlobal('navigator', {
    userAgent: opcoes.ua ?? 'Mozilla/5.0 Chrome',
    standalone: opcoes.standalone,
    serviceWorker: { getRegistration: vi.fn().mockResolvedValue(opcoes.registro ?? null) },
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', Object.assign(class {}, { permission: opcoes.permissao ?? 'default', requestPermission: vi.fn().mockResolvedValue('granted') }))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  limparCredenciais()
  vi.unstubAllGlobals()
})

describe('urlBase64ParaBytes', () => {
  it('converte base64url (com - e _, sem padding) em bytes', () => {
    expect([...urlBase64ParaBytes('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ParaBytes('-_8')]).toEqual([251, 255])
  })
})

describe('estadoPush', () => {
  it('iPhone sem o app instalado pede a instalação (push só funciona instalado)', async () => {
    ambiente({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })
    expect(await estadoPush()).toBe('instalar')
  })

  it('sem suporte, bloqueado, sem service worker e servidor sem chave', async () => {
    vi.stubGlobal('navigator', { userAgent: 'x' })
    expect(await estadoPush()).toBe('sem_suporte')
    ambiente({ permissao: 'denied' })
    expect(await estadoPush()).toBe('negado')
    ambiente({ registro: null })
    expect(await estadoPush()).toBe('sem_service_worker')
    ambiente({ registro: { pushManager: { getSubscription: vi.fn() } } })
    fetchMock.mockResolvedValueOnce(resposta(404, {}))
    expect(await estadoPush()).toBe('indisponivel')
  })

  it('desligado sem inscrição; ligado só se o servidor reconhece o dispositivo como do usuário', async () => {
    const sub = inscricao()
    const getSubscription = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(sub)
    ambiente({ registro: { pushManager: { getSubscription } } })
    fetchMock.mockResolvedValue(resposta(200, { chave: 'K' }))
    expect(await estadoPush()).toBe('desligado')
    fetchMock.mockResolvedValueOnce(resposta(200, { chave: 'K' })).mockResolvedValueOnce(resposta(200, { id: 'd1' }))
    expect(await estadoPush()).toBe('ligado')
    fetchMock.mockResolvedValueOnce(resposta(200, { chave: 'K' })).mockResolvedValueOnce(resposta(200, { id: null }))
    expect(await estadoPush()).toBe('desligado') // inscrição do navegador que é de outra conta
  })
})

describe('ativarPush e desativarPush', () => {
  it('pede permissão, inscreve com a chave do servidor e registra só endpoint e chaves', async () => {
    const sub = inscricao()
    const subscribe = vi.fn().mockResolvedValue(sub)
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } } })
    fetchMock.mockResolvedValueOnce(resposta(200, { chave: 'AQID' })).mockResolvedValueOnce(resposta(201, { id: 'd1' }))
    await ativarPush()
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) })
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/dispositivos-push')
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      chaves: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    })
  })

  it('inscrição criada com outra chave VAPID é refeita (senão receberia 403 para sempre)', async () => {
    const velha = { ...inscricao(), options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer } }
    const nova = inscricao()
    const subscribe = vi.fn().mockResolvedValue(nova)
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(velha), subscribe } } })
    fetchMock.mockResolvedValueOnce(resposta(200, { chave: 'AQID' })).mockResolvedValueOnce(resposta(201, { id: 'd1' }))
    await ativarPush()
    expect(velha.unsubscribe).toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('inscrição com a mesma chave é reaproveitada', async () => {
    const igual = { ...inscricao(), options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer } }
    const subscribe = vi.fn()
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(igual), subscribe } } })
    fetchMock.mockResolvedValueOnce(resposta(200, { chave: 'AQID' })).mockResolvedValueOnce(resposta(201, { id: 'd1' }))
    await ativarPush()
    expect(subscribe).not.toHaveBeenCalled()
    expect(igual.unsubscribe).not.toHaveBeenCalled()
  })

  it('permissão negada não inscreve nada', async () => {
    const subscribe = vi.fn()
    ambiente({ registro: { pushManager: { getSubscription: vi.fn(), subscribe } } })
    ;(Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied')
    await expect(ativarPush()).rejects.toThrow(/negada/)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('desativar revoga no servidor e cancela a inscrição local', async () => {
    const sub = inscricao()
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } } })
    fetchMock.mockResolvedValueOnce(resposta(204, null))
    await desativarPush()
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/dispositivos-push/revogar')
    expect(sub.unsubscribe).toHaveBeenCalled()
  })
})

describe('cancelarPushAoSair (T5.26)', () => {
  it('revoga no servidor e cancela a inscrição local', async () => {
    const sub = inscricao()
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } } })
    fetchMock.mockResolvedValueOnce(resposta(204, null))
    await cancelarPushAoSair(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sub.unsubscribe).toHaveBeenCalled()
  })

  it('cancela a inscrição local mesmo que o servidor não responda, e não lança erro', async () => {
    const sub = inscricao()
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } } })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(cancelarPushAoSair(true)).resolves.toBeUndefined()
    expect(sub.unsubscribe).toHaveBeenCalled()
  })

  it('sem service worker ou sem inscrição, não faz nada e não lança erro', async () => {
    vi.stubGlobal('navigator', {})
    await expect(cancelarPushAoSair(true)).resolves.toBeUndefined()
    ambiente({ registro: { pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } } })
    await cancelarPushAoSair(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
