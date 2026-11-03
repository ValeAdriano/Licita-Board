import { afterEach, describe, expect, it, vi } from 'vitest'
import { chamar, definirCsrf, ErroApi, limparCredenciais, observarCliente } from './cliente'

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response
}

afterEach(() => limparCredenciais())

describe('chamar', () => {
  it('usa o cookie da mesma origem e manda o CSRF só em método que altera estado (nunca token)', async () => {
    definirCsrf('c1')
    const fetcher = vi.fn().mockResolvedValue(resposta(200, { ok: 1 }))
    await expect(chamar('POST', '/x', { a: 1 }, { fetcher })).resolves.toEqual({ ok: 1 })
    await chamar('GET', '/y', undefined, { fetcher })
    const [url, post] = fetcher.mock.calls[0] as [string, RequestInit]
    const [, get] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/x')
    expect(post.credentials).toBe('same-origin')
    expect(post.headers).toMatchObject({ 'X-CSRF-Token': 'c1', 'Content-Type': 'application/json' })
    expect(post.headers).not.toHaveProperty('Authorization')
    expect(get.headers).not.toHaveProperty('X-CSRF-Token')
  })

  it('mostra a mensagem da API em 400/401 e genérica nos outros erros', async () => {
    const f400 = vi.fn().mockResolvedValue(resposta(400, { message: 'Código inválido.' }))
    await expect(chamar('POST', '/x', {}, { fetcher: f400 })).rejects.toEqual(new ErroApi(400, 'Código inválido.'))
    const f401 = vi.fn().mockResolvedValue(resposta(401, { message: 'E-mail ou senha incorretos.' }))
    await expect(chamar('POST', '/auth/login', {}, { fetcher: f401 })).rejects.toThrow('E-mail ou senha incorretos.')
    const sessao = vi.fn().mockResolvedValue(resposta(401, { message: 'Unauthorized' }))
    await expect(chamar('GET', '/me', undefined, { fetcher: sessao })).rejects.toThrow('Sua sessão terminou. Entre de novo.')
    const f500 = vi.fn().mockResolvedValue(resposta(500, { message: 'detalhe interno' }))
    await expect(chamar('GET', '/x', undefined, { fetcher: f500 })).rejects.toThrow('Algo deu errado. Tente de novo.')
    const rede = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(chamar('GET', '/x', undefined, { fetcher: rede })).rejects.toMatchObject({ status: 0 })
  })

  it('avisa a perda de sessão em 401 (menos no login) e registra uso só no que não é de fundo', async () => {
    const aoPerderSessao = vi.fn()
    const aoUsar = vi.fn()
    observarCliente({ aoPerderSessao, aoUsar })
    await expect(chamar('GET', '/x', undefined, { fetcher: vi.fn().mockResolvedValue(resposta(401, {})) })).rejects.toMatchObject({ status: 401 })
    expect(aoPerderSessao).toHaveBeenCalledTimes(1)
    await expect(chamar('POST', '/auth/login', {}, { fetcher: vi.fn().mockResolvedValue(resposta(401, {})) })).rejects.toMatchObject({ status: 401 })
    expect(aoPerderSessao).toHaveBeenCalledTimes(1) // login recusado não é sessão perdida

    // 401 de requisição enviada antes de uma rotação do cookie não derruba a sessão nova.
    let responder401: (r: Response) => void = () => {}
    const antiga = chamar('GET', '/notificacoes', undefined, { fetcher: vi.fn(() => new Promise<Response>((ok) => (responder401 = ok))) })
    await chamar('POST', '/auth/mfa/verificar', { codigo: '123456' }, { fetcher: vi.fn().mockResolvedValue(resposta(200, {})) })
    responder401(resposta(401, {}))
    await expect(antiga).rejects.toMatchObject({ status: 401 })
    expect(aoPerderSessao).toHaveBeenCalledTimes(1)

    expect(aoUsar).toHaveBeenCalledTimes(1) // só a verificação que deu certo
    await chamar('POST', '/x', undefined, { fetcher: vi.fn().mockResolvedValue(resposta(204, null)) })
    expect(aoUsar).toHaveBeenCalledTimes(2)
    const fundo = vi.fn().mockResolvedValue(resposta(200, []))
    await chamar('GET', '/notificacoes', undefined, { fetcher: fundo, fundo: true })
    expect(aoUsar).toHaveBeenCalledTimes(2) // polling não conta como uso
    expect((fundo.mock.calls[0] as [string, RequestInit])[1].headers).toMatchObject({ 'X-VV-Fundo': '1' })
  })

  it('403 "MFA" avisa que a sessão precisa do segundo fator (e outro 403 não)', async () => {
    const aoExigirMfa = vi.fn()
    observarCliente({ aoPerderSessao: vi.fn(), aoUsar: vi.fn(), aoRelerSessao: aoExigirMfa })
    await expect(chamar('GET', '/me', undefined, { fetcher: vi.fn().mockResolvedValue(resposta(403, { message: 'MFA' })) })).rejects.toMatchObject({ status: 403 })
    expect(aoExigirMfa).toHaveBeenCalledTimes(1)
    await expect(chamar('GET', '/x', undefined, { fetcher: vi.fn().mockResolvedValue(resposta(403, { message: 'Forbidden' })) })).rejects.toMatchObject({ status: 403 })
    expect(aoExigirMfa).toHaveBeenCalledTimes(1)
    await expect(chamar('POST', '/x', {}, { fetcher: vi.fn().mockResolvedValue(resposta(403, { message: 'CSRF' })) })).rejects.toMatchObject({ status: 403 })
    expect(aoExigirMfa).toHaveBeenCalledTimes(2) // CSRF obsoleto (outra aba) também relê a sessão
  })

  it('401 da própria chamada que rotaciona (ex.: código de MFA com sessão morta) derruba a sessão', async () => {
    const aoPerderSessao = vi.fn()
    observarCliente({ aoPerderSessao, aoUsar: vi.fn() })
    await expect(chamar('POST', '/auth/mfa/verificar', {}, { fetcher: vi.fn().mockResolvedValue(resposta(401, {})) })).rejects.toMatchObject({ status: 401 })
    expect(aoPerderSessao).toHaveBeenCalledTimes(1)
  })
})
