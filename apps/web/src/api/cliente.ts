import { API_URL } from '../config'

// Cliente único da API (ADR-012, ADR-018). A sessão vai no cookie HttpOnly (o JavaScript nunca vê o
// token) e o CSRF segue por double submit no header X-CSRF-Token. Nada de token em storage.
export class ErroApi extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
  }
}

const MENSAGENS: Record<number, string> = {
  0: 'Sem conexão com o servidor. Tente de novo.',
  401: 'Sua sessão terminou. Entre de novo.',
  403: 'Você não tem permissão para isso.',
  404: 'Não encontrado.',
  429: 'Muitas tentativas. Tente mais tarde.',
}

let csrf: string | null = null
let aoPerderSessao: () => void = () => {}
let aoUsar: () => void = () => {}
// A API respondeu 403 "MFA" (o perfil passou a exigir segundo fator, ex.: convite interno aceito) ou
// 403 "CSRF" (cookie de CSRF trocado por outra aba): o front relê o estado da sessão (MFA, CSRF e
// quem está logado).
let aoRelerSessao: () => void = () => {}
// Rotação da sessão (elevação a aal2, troca de senha): uma requisição enviada antes pode voltar 401
// sem que a sessão tenha acabado. Só derruba a sessão o 401 de uma requisição feita depois da última
// rotação e sem rotação em andamento (senão o cookie NOVO seria descartado).
let geracao = 0
let rotacoesEmVoo = 0
const ROTACIONAM = new Set(['/auth/senha', '/auth/mfa/confirmar', '/auth/mfa/verificar', '/auth/mfa/recuperacao', '/auth/mfa/step-up'])

export function definirCsrf(valor: string | null): void {
  csrf = valor
}

export function limparCredenciais(): void {
  csrf = null
  geracao += 1
}

export function observarCliente(o: { aoPerderSessao: () => void; aoUsar: () => void; aoRelerSessao?: () => void }): void {
  aoPerderSessao = o.aoPerderSessao
  aoUsar = o.aoUsar
  aoRelerSessao = o.aoRelerSessao ?? (() => {})
}

function mensagemDe(status: number, corpo: unknown): string {
  const m = (corpo as { message?: unknown } | null)?.message
  // Só a mensagem que a API escreveu para o usuário (texto em português, como o login recusado em
  // 401); o texto padrão do Nest e os outros status viram mensagem genérica.
  if ((status === 400 || status === 401) && typeof m === 'string' && m !== 'Bad Request' && m !== 'Unauthorized') return m
  return MENSAGENS[status] ?? 'Algo deu errado. Tente de novo.'
}

export interface OpcoesChamada {
  // Consulta automática (polling): não conta como uso, nem no app nem na API (T5.17).
  fundo?: boolean
  fetcher?: typeof fetch
}

export async function chamar<T>(
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  opcoes: OpcoesChamada = {},
): Promise<T> {
  const { fundo = false, fetcher = fetch } = opcoes
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (corpo !== undefined) headers['Content-Type'] = 'application/json'
  if (fundo) headers['X-VV-Fundo'] = '1'
  if (csrf && metodo !== 'GET') headers['X-CSRF-Token'] = csrf
  const geracaoNoEnvio = geracao
  const rotaciona = ROTACIONAM.has(caminho)
  if (rotaciona) rotacoesEmVoo += 1
  let res: Response
  try {
    res = await fetcher(`${API_URL}${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new ErroApi(0, MENSAGENS[0] ?? '')
  } finally {
    if (rotaciona) rotacoesEmVoo -= 1
  }
  const dados: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  const atual = geracaoNoEnvio === geracao && rotacoesEmVoo === 0
  if (!res.ok) {
    const aviso = (dados as { message?: unknown } | null)?.message
    if (res.status === 401 && caminho !== '/auth/login' && atual) aoPerderSessao()
    if (res.status === 403 && (aviso === 'MFA' || aviso === 'CSRF') && atual) aoRelerSessao()
    throw new ErroApi(res.status, mensagemDe(res.status, dados))
  }
  // O cookie mudou: respostas de requisições enviadas antes não valem para derrubar a sessão nova.
  // (Rotação que falhou não muda nada: nenhuma sessão nova a proteger.)
  if (rotaciona) geracao += 1
  if (!fundo) aoUsar()
  return dados as T
}
