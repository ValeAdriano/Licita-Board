import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';
import { SessaoProvider, useSessao } from './sessao';

jest.mock('expo-secure-store', () => {
  const dados = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
    getItemAsync: jest.fn((k: string) => Promise.resolve(dados.get(k) ?? null)),
    setItemAsync: jest.fn((k: string, v: string) => Promise.resolve(void dados.set(k, v))),
    deleteItemAsync: jest.fn((k: string) => Promise.resolve(void dados.delete(k))),
  };
});

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response;
}

function Sonda() {
  const s = useSessao();
  return (
    <>
      <Text>fase:{s.fase}</Text>
      <Text onPress={() => void s.entrar('a@b.c', 'senha-longa-123').catch(() => {})}>entrar</Text>
      <Text onPress={() => void s.elevar('verificar', '123456').then(s.concluirMfa)}>mfa</Text>
      <Text onPress={() => void s.sair().catch(() => {})}>sair</Text>
      <Text onPress={s.recarregar}>recarregar</Text>
    </>
  );
}

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

describe('SessaoProvider (nativo)', () => {
  it('sem token guardado começa anônimo, sem chamar a API', async () => {
    await render(<SessaoProvider><Sonda /></SessaoProvider>);
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('login pede MFA, a elevação troca o token guardado e sair apaga', async () => {
    await render(<SessaoProvider><Sonda /></SessaoProvider>);
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeTruthy());

    fetchMock.mockResolvedValueOnce(resposta(200, { mfa: 'verificar', token: 'tok-aal1' }));
    await fireEvent.press(screen.getByText('entrar'));
    await waitFor(() => expect(screen.getByText('fase:mfa')).toBeTruthy());
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ plataforma: 'ios' });
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('vv.sessao', 'tok-aal1', expect.anything());

    fetchMock.mockResolvedValueOnce(resposta(200, { token: 'tok-aal2' }));
    await fireEvent.press(screen.getByText('mfa'));
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeTruthy());
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('vv.sessao', 'tok-aal2', expect.anything());
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer tok-aal1' });

    fetchMock.mockResolvedValueOnce(resposta(204, null));
    await fireEvent.press(screen.getByText('sair'));
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeTruthy());
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('vv.sessao');
  });

  it('sessão guardada que a API recusa (401) volta para anônimo e some do aparelho', async () => {
    await SecureStore.setItemAsync('vv.sessao', 'tok-velho');
    fetchMock.mockResolvedValueOnce(resposta(401, {}));
    await render(<SessaoProvider><Sonda /></SessaoProvider>);
    await waitFor(() => expect(screen.getByText('fase:anonimo')).toBeTruthy());
    expect(await SecureStore.getItemAsync('vv.sessao')).toBeNull();
  });

  it('sem rede no início guarda o token e oferece tentar de novo', async () => {
    await SecureStore.setItemAsync('vv.sessao', 'tok-guardado');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await render(<SessaoProvider><Sonda /></SessaoProvider>);
    await waitFor(() => expect(screen.getByText('fase:sem_conexao')).toBeTruthy());
    expect(await SecureStore.getItemAsync('vv.sessao')).toBe('tok-guardado');

    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal2', mfa: 'nao_requerido' }));
    await fireEvent.press(screen.getByText('recarregar'));
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeTruthy());
  });

  it('sair que o servidor não confirmou mantém a sessão (não finge que saiu)', async () => {
    await SecureStore.setItemAsync('vv.sessao', 'tok-vivo');
    fetchMock.mockResolvedValueOnce(resposta(200, { aal: 'aal2', mfa: 'nao_requerido' }));
    await render(<SessaoProvider><Sonda /></SessaoProvider>);
    await waitFor(() => expect(screen.getByText('fase:ativa')).toBeTruthy());

    fetchMock.mockResolvedValueOnce(resposta(503, {}));
    await fireEvent.press(screen.getByText('sair'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('fase:ativa')).toBeTruthy();
    expect(await SecureStore.getItemAsync('vv.sessao')).toBe('tok-vivo');
  });
});
