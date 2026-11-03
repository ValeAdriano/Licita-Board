import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConvidarUsuario } from './ConvidarUsuario';
import { cnpjLegivel, ConvitesRecebidos } from './ConvitesRecebidos';
import { EditorVinculo } from './EditorVinculo';
import { MatrizEditavel } from './MatrizEditavel';
import { convitePendente } from './tipos';

const mockStepUp = jest.fn();
const mockRecarregar = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../auth/sessao', () => ({ useSessao: () => ({ stepUp: mockStepUp }) }));
jest.mock('../contexto', () => ({ useAcesso: () => ({ recarregar: mockRecarregar, pode: () => true }) }));

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response;
}

const modulos = [{ slug: 'agenda', nome: 'Agenda' }];
const membro = {
  vinculoId: 'v1', usuarioId: 'u1', nome: 'Bia', email: 'bia@teste.local', papel: 'OPERADOR' as const,
  ativo: true, permissoes: ['agenda:visualizar'],
};
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(resposta(200, {}));
  mockStepUp.mockReset().mockResolvedValue('step-up-1');
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

async function abrir(podeAdministrar = true) {
  const aoSalvar = jest.fn();
  await render(<EditorVinculo membro={membro} modulos={modulos} podeAdministrar={podeAdministrar} aoSalvar={aoSalvar} aoFechar={jest.fn()} />);
  return aoSalvar;
}

describe('EditorVinculo', () => {
  it('sem alteração, salvar não abre a confirmação', async () => {
    await abrir();
    await fireEvent.press(screen.getByText('Salvar alterações'));
    expect(screen.queryByText('Confirmar operação crítica')).toBeNull();
  });

  it('salvar pede step-up e grava exatamente o que estava na tela ao confirmar', async () => {
    const aoSalvar = await abrir();
    await fireEvent.press(screen.getByLabelText('Agenda: Editar'));
    await fireEvent.press(screen.getByText('Salvar alterações'));
    await fireEvent.changeText(screen.getByLabelText('Código do autenticador'), '123456');
    // Depois de abrir a confirmação, mexer na tela não muda o que será gravado.
    await fireEvent.press(screen.getByLabelText('Agenda: Exportar'));
    await fireEvent.press(screen.getByText('Confirmar'));
    await waitFor(() => expect(aoSalvar).toHaveBeenCalled());
    expect(mockStepUp).toHaveBeenCalledWith('alterar_permissoes', '123456');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/vinculos/v1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      papel: 'OPERADOR', ativo: true, permissoes: ['agenda:editar', 'agenda:visualizar'], stepUp: 'step-up-1',
    });
    expect(mockRecarregar).toHaveBeenCalled();
  });

  it('mostra a recusa da API sem fingir que salvou', async () => {
    fetchMock.mockResolvedValue(resposta(400, { message: 'permissão excede o que você tem' }));
    const aoSalvar = await abrir();
    await fireEvent.press(screen.getByLabelText('Agenda: Editar'));
    await fireEvent.press(screen.getByText('Salvar alterações'));
    await fireEvent.changeText(screen.getByLabelText('Código do autenticador'), '123456');
    await fireEvent.press(screen.getByText('Confirmar'));
    await waitFor(() => expect(screen.getByText(/permissão excede o que você tem/)).toBeTruthy());
    expect(screen.getByText(/aguarde o próximo código/)).toBeTruthy();
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it('sem permissão para administrar, a matriz fica travada e não há como salvar', async () => {
    await abrir(false);
    expect(screen.queryByText('Salvar alterações')).toBeNull();
    expect(screen.getByLabelText('Agenda: Editar')).toBeDisabled();
  });

  it('papel CLIENTE só aceita a ação visualizar', async () => {
    await render(
      <EditorVinculo membro={{ ...membro, papel: 'CLIENTE' }} modulos={modulos} podeAdministrar aoSalvar={jest.fn()} aoFechar={jest.fn()} />,
    );
    expect(screen.getByLabelText('Agenda: Editar')).toBeDisabled();
    expect(screen.getByLabelText('Agenda: Visualizar')).not.toBeDisabled();
  });
});

describe('convitePendente', () => {
  const base = { id: 'c', email: 'a@b.c', papel: 'OPERADOR' as const, permissoes: [], criadoEm: '2026-11-01T00:00:00Z', aceitoEm: null, revogadoEm: null };
  const agora = new Date('2026-11-03T12:00:00Z').getTime();

  it('pendente só se não aceito, não revogado e não vencido', () => {
    expect(convitePendente({ ...base, expiraEm: '2026-11-08T00:00:00Z' }, agora)).toBe(true);
    expect(convitePendente({ ...base, expiraEm: '2026-11-02T00:00:00Z' }, agora)).toBe(false);
    expect(convitePendente({ ...base, expiraEm: '2026-11-08T00:00:00Z', aceitoEm: '2026-11-03T00:00:00Z' }, agora)).toBe(false);
    expect(convitePendente({ ...base, expiraEm: '2026-11-08T00:00:00Z', revogadoEm: '2026-11-03T00:00:00Z' }, agora)).toBe(false);
  });
});

describe('StepUpModal (pelo editor)', () => {
  async function abrirConfirmacao() {
    const aoSalvar = await abrir();
    await fireEvent.press(screen.getByLabelText('Agenda: Editar'));
    await fireEvent.press(screen.getByText('Salvar alterações'));
    await fireEvent.changeText(screen.getByLabelText('Código do autenticador'), '123456');
    return aoSalvar;
  }

  it('mostra o resumo do que será gravado antes do código', async () => {
    await abrirConfirmacao();
    expect(screen.getByText('Alterar: Bia')).toBeTruthy();
    expect(screen.getByText('Papel: Operador · acesso ativo')).toBeTruthy();
    expect(screen.getByText('Permissões: +1 · −0 (total 2)')).toBeTruthy();
  });

  it('Enter duplo manda o código uma vez só (o repetido contaria erro de MFA)', async () => {
    let liberar: (id: string) => void = () => {};
    mockStepUp.mockReturnValue(new Promise<string>((ok) => (liberar = ok)));
    await abrirConfirmacao();
    const campo = screen.getByLabelText('Código do autenticador');
    await fireEvent(campo, 'submitEditing');
    await fireEvent(campo, 'submitEditing');
    expect(mockStepUp).toHaveBeenCalledTimes(1);
    liberar('step-up-1');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('o mesmo código não é reenviado depois de usado', async () => {
    fetchMock.mockResolvedValue(resposta(400, { message: 'recusado' }));
    await abrirConfirmacao();
    await fireEvent.press(screen.getByText('Confirmar'));
    await waitFor(() => expect(screen.getByText(/recusado/)).toBeTruthy());
    expect(mockStepUp).toHaveBeenCalledTimes(1);
    // reabre a confirmação com o mesmo código na tela do autenticador
    await fireEvent.press(screen.getByText('Salvar alterações'));
    await fireEvent.changeText(screen.getByLabelText('Código do autenticador'), '123456');
    await fireEvent.press(screen.getByText('Confirmar'));
    expect(screen.getByText(/Esse código já foi usado/)).toBeTruthy();
    expect(mockStepUp).toHaveBeenCalledTimes(1);
  });

  it('cancelar durante a conferência do código impede a operação crítica', async () => {
    let liberar: (id: string) => void = () => {};
    mockStepUp.mockReturnValue(new Promise<string>((ok) => (liberar = ok)));
    const aoSalvar = await abrirConfirmacao();
    await fireEvent.press(screen.getByText('Confirmar'));
    await fireEvent.press(screen.getByText('Cancelar'));
    liberar('step-up-1');
    await waitFor(() => expect(mockStepUp).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(aoSalvar).not.toHaveBeenCalled();
  });
});

describe('MatrizEditavel: teto de concessão', () => {
  it('trava o que quem concede não tem, mas deixa remover o que já estava marcado', async () => {
    await render(
      <MatrizEditavel
        modulos={modulos}
        papel="OPERADOR"
        selecao={new Set(['agenda:exportar'])}
        aoMudar={jest.fn()}
        somenteLeitura={false}
        podeConceder={(_m, a) => a === 'editar'}
      />,
    );
    expect(screen.getByLabelText('Agenda: Editar')).not.toBeDisabled();
    expect(screen.getByLabelText('Agenda: Cadastrar')).toBeDisabled();
    expect(screen.getByLabelText('Agenda: Exportar')).not.toBeDisabled();
  });
});

describe('ConvidarUsuario', () => {
  it('começa sem nenhuma permissão marcada e pede um e-mail válido antes do step-up', async () => {
    await render(<ConvidarUsuario empresaId="e1" modulos={modulos} aoConcluir={jest.fn()} aoCancelar={jest.fn()} />);
    expect(screen.queryByText(/✓/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('E-mail do convidado'), 'isso-nao-e-email');
    await fireEvent.press(screen.getByText('Enviar convite'));
    expect(screen.getByText('Informe um e-mail válido.')).toBeTruthy();
    expect(screen.queryByText('Confirmar operação crítica')).toBeNull();
  });

  it('mostra no resumo quem será convidado e com quantas permissões', async () => {
    await render(<ConvidarUsuario empresaId="e1" modulos={modulos} aoConcluir={jest.fn()} aoCancelar={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('E-mail do convidado'), 'nova@teste.local');
    await fireEvent.press(screen.getByLabelText('Agenda: Visualizar'));
    await fireEvent.press(screen.getByText('Enviar convite'));
    expect(screen.getByText('Convidar: nova@teste.local')).toBeTruthy();
    expect(screen.getByText('Permissões: 1')).toBeTruthy();
  });
});

describe('ConvitesRecebidos (T3.1c)', () => {
  const convite = {
    id: 'c1', empresa: 'Alfa Ltda', cnpj: '11222333000181', convidado_por: 'Admin Demo',
    papel: 'OPERADOR', permissoes: ['agenda:visualizar'], expira_em: '2026-11-10T00:00:00Z',
  };

  it('mostra CNPJ e quem convidou e só aceita depois da revisão', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(resposta(200, url.endsWith('/me/convites') ? [convite] : {})));
    await render(<ConvitesRecebidos />);
    await waitFor(() => expect(screen.getByText('Alfa Ltda')).toBeTruthy());
    expect(screen.getByText('CNPJ 11.222.333/0001-81')).toBeTruthy();
    expect(screen.getByText('Convidado por Admin Demo')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/aceitar'))).toBe(false);
    await fireEvent.press(screen.getByText('Revisar convite'));
    await fireEvent.press(screen.getByText('Confirmar e aceitar'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/me/convites/c1/aceitar'))).toBe(true));
  });

  it('formata o CNPJ numérico e o alfanumérico', () => {
    expect(cnpjLegivel('11222333000181')).toBe('11.222.333/0001-81');
    expect(cnpjLegivel('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(cnpjLegivel('inválido')).toBe('inválido');
  });
});
