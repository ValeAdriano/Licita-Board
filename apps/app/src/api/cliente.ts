import { Platform } from 'react-native';
import { API_URL } from '../config';

// Cliente único da API (ADR-012). Web: sessão no cookie HttpOnly (o app nunca vê o token) e CSRF por
// double submit no header. Nativo: token opaco no SecureStore, enviado como Bearer.
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const MENSAGENS: Record<number, string> = {
  0: 'Sem conexão com o servidor. Tente de novo.',
  401: 'Sua sessão terminou. Entre de novo.',
  403: 'Você não tem permissão para isso.',
  404: 'Não encontrado.',
  429: 'Muitas tentativas. Tente mais tarde.',
};

type Credenciais = { token: string | null; csrf: string | null };
const credenciais: Credenciais = { token: null, csrf: null };
let aoPerderSessao: () => void = () => {};
let aoUsar: () => void = () => {};

export function definirCredenciais(c: Partial<Credenciais>): void {
  Object.assign(credenciais, c);
}

export function limparCredenciais(): void {
  credenciais.token = null;
  credenciais.csrf = null;
}

export function observarCliente(o: { aoPerderSessao: () => void; aoUsar: () => void }): void {
  aoPerderSessao = o.aoPerderSessao;
  aoUsar = o.aoUsar;
}

function mensagemDe(status: number, corpo: unknown): string {
  const m = (corpo as { message?: unknown } | null)?.message;
  // Só a mensagem que a API escreveu para o usuário (texto em português, como o login recusado em
  // 401); o texto padrão do Nest e os outros status viram mensagem genérica.
  if ((status === 400 || status === 401) && typeof m === 'string' && m !== 'Bad Request' && m !== 'Unauthorized') return m;
  return MENSAGENS[status] ?? 'Algo deu errado. Tente de novo.';
}

export async function chamar<T>(
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  opcoes: { fundo?: boolean; fetcher?: typeof fetch } = {},
): Promise<T> {
  const { fundo = false, fetcher = fetch } = opcoes;
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Consulta automática (polling): não conta como uso, nem no app nem na API (T5.17).
  if (fundo) headers['X-VV-Fundo'] = '1';
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (Platform.OS === 'web') {
    if (credenciais.csrf && metodo !== 'GET') headers['X-CSRF-Token'] = credenciais.csrf;
  } else if (credenciais.token) {
    headers.Authorization = `Bearer ${credenciais.token}`;
  }
  let res: Response;
  try {
    res = await fetcher(`${API_URL}${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: Platform.OS === 'web' ? 'include' : 'omit',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErroApi(0, MENSAGENS[0] ?? '');
  }
  const dados: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && caminho !== '/auth/login') aoPerderSessao();
    throw new ErroApi(res.status, mensagemDe(res.status, dados));
  }
  if (!fundo) aoUsar();
  return dados as T;
}
