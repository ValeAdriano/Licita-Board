import { Platform } from 'react-native';
import { chamar, definirCredenciais, ErroApi, limparCredenciais, observarCliente } from './cliente';

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response;
}

const os = Platform.OS;
afterEach(() => {
  Platform.OS = os;
  limparCredenciais();
});

describe('chamar', () => {
  it('nativo manda o token como Bearer e não usa cookie', async () => {
    Platform.OS = 'ios';
    definirCredenciais({ token: 'tok', csrf: 'nao-usado' });
    const fetcher = jest.fn().mockResolvedValue(resposta(200, { ok: 1 }));
    await expect(chamar('POST', '/x', { a: 1 }, { fetcher })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/x');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(init.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('web usa o cookie e manda o CSRF só em método que altera estado', async () => {
    Platform.OS = 'web';
    definirCredenciais({ token: 'nunca-no-web', csrf: 'c1' });
    const fetcher = jest.fn().mockResolvedValue(resposta(200, {}));
    await chamar('POST', '/x', {}, { fetcher });
    await chamar('GET', '/y', undefined, { fetcher });
    const [, post] = fetcher.mock.calls[0] as [string, RequestInit];
    const [, get] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(post.credentials).toBe('include');
    expect(post.headers).toMatchObject({ 'X-CSRF-Token': 'c1' });
    expect(post.headers).not.toHaveProperty('Authorization');
    expect(get.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('mostra a mensagem da API em 400 e genérica nos outros erros', async () => {
    const f400 = jest.fn().mockResolvedValue(resposta(400, { message: 'Código inválido.' }));
    await expect(chamar('POST', '/x', {}, { fetcher: f400 })).rejects.toEqual(new ErroApi(400, 'Código inválido.'));
    const f401 = jest.fn().mockResolvedValue(resposta(401, { message: 'E-mail ou senha incorretos.' }));
    await expect(chamar('POST', '/auth/login', {}, { fetcher: f401 })).rejects.toThrow('E-mail ou senha incorretos.');
    const sessao = jest.fn().mockResolvedValue(resposta(401, { message: 'Unauthorized' }));
    await expect(chamar('GET', '/me', undefined, { fetcher: sessao })).rejects.toThrow('Sua sessão terminou. Entre de novo.');
    const f500 = jest.fn().mockResolvedValue(resposta(500, { message: 'detalhe interno' }));
    await expect(chamar('GET', '/x', undefined, { fetcher: f500 })).rejects.toThrow('Algo deu errado. Tente de novo.');
    const rede = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(chamar('GET', '/x', undefined, { fetcher: rede })).rejects.toMatchObject({ status: 0 });
  });

  it('avisa a perda de sessão em 401 e registra uso no sucesso', async () => {
    const aoPerderSessao = jest.fn();
    const aoUsar = jest.fn();
    observarCliente({ aoPerderSessao, aoUsar });
    await expect(chamar('GET', '/x', undefined, { fetcher: jest.fn().mockResolvedValue(resposta(401, {})) })).rejects.toMatchObject({ status: 401 });
    expect(aoPerderSessao).toHaveBeenCalledTimes(1);
    await expect(chamar('POST', '/auth/login', {}, { fetcher: jest.fn().mockResolvedValue(resposta(401, {})) })).rejects.toMatchObject({ status: 401 });
    expect(aoPerderSessao).toHaveBeenCalledTimes(1); // login recusado não é sessão perdida
    // 401 de requisição enviada antes de uma rotação do token não derruba a sessão nova.
    let responder401: (r: Response) => void = () => {};
    const antiga = chamar('GET', '/notificacoes', undefined, {
      fetcher: jest.fn(() => new Promise<Response>((ok) => (responder401 = ok))),
    });
    await chamar('POST', '/auth/mfa/verificar', { codigo: '123456' }, { fetcher: jest.fn().mockResolvedValue(resposta(200, {})) });
    responder401(resposta(401, {}));
    await expect(antiga).rejects.toMatchObject({ status: 401 });
    expect(aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(aoUsar).toHaveBeenCalledTimes(1); // só a verificação que deu certo
    await chamar('POST', '/x', undefined, { fetcher: jest.fn().mockResolvedValue(resposta(204, null)) });
    expect(aoUsar).toHaveBeenCalledTimes(2);
    const fundo = jest.fn().mockResolvedValue(resposta(200, []));
    await chamar('GET', '/notificacoes', undefined, { fetcher: fundo, fundo: true });
    expect(aoUsar).toHaveBeenCalledTimes(2); // polling não conta como uso
    expect((fundo.mock.calls[0] as [string, RequestInit])[1].headers).toMatchObject({ 'X-VV-Fundo': '1' });
  });
});
