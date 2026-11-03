import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AcessoProvider, INTERVALO_NOTIFICACOES_MS, modulosDe, useAcesso } from './contexto';

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response;
}

const ME = {
  usuario: { id: 'u1', email: 'a@teste.local', nome: 'Ana', telefone: null, oab: null, superadmin: false, temMfa: true },
  vinculos: [
    { id: 'v1', empresaId: 'e1', empresa: 'Alfa', papel: 'CLIENTE', ativo: true, permissoes: ['agenda:visualizar'] },
    { id: 'v2', empresaId: 'e2', empresa: 'Inativa', papel: 'CLIENTE', ativo: false, permissoes: [] },
  ],
};

function Sonda() {
  const a = useAcesso();
  return (
    <>
      <Text>empresa:{a.empresa?.empresa ?? '-'}</Text>
      <Text>vinculos:{a.vinculos.length}</Text>
      <Text>naoLidas:{a.naoLidas}</Text>
    </>
  );
}

const fetchMock = jest.fn((url: string) =>
  Promise.resolve(
    url.endsWith('/me')
      ? resposta(200, ME)
      : resposta(200, [{ id: 'n1', titulo: 'Aviso', corpo: null, lidaEm: null, criadaEm: '2026-11-03T12:00:00Z' }]),
  ),
);

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => jest.useRealTimers());

describe('AcessoProvider', () => {
  it('mostra só vínculos ativos, seleciona o primeiro e conta as não lidas', async () => {
    await render(<AcessoProvider><Sonda /></AcessoProvider>);
    await waitFor(() => expect(screen.getByText('empresa:Alfa')).toBeTruthy());
    expect(screen.getByText('vinculos:1')).toBeTruthy();
    expect(screen.getByText('naoLidas:1')).toBeTruthy();
  });

  it('o polling de notificações vai marcado como fundo (não renova a inatividade)', async () => {
    await render(<AcessoProvider><Sonda /></AcessoProvider>);
    await waitFor(() => expect(screen.getByText('naoLidas:1')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(INTERVALO_NOTIFICACOES_MS);
    });
    const polls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/notificacoes'));
    expect(polls.length).toBeGreaterThanOrEqual(2);
    for (const [, init] of polls as unknown as [string, RequestInit][]) {
      expect(init.headers).toMatchObject({ 'X-VV-Fundo': '1' });
    }
    const me = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/me')) as unknown as [string, RequestInit];
    expect(me[1].headers).not.toHaveProperty('X-VV-Fundo');
  });
});

describe('modulosDe', () => {
  it('agrupa as permissões por módulo, sem repetir', () => {
    expect(modulosDe(['editais:visualizar', 'agenda:editar', 'agenda:visualizar'])).toEqual(['agenda', 'editais']);
  });
});
