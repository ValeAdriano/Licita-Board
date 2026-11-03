import { createHash } from 'node:crypto';

// Senha vazada (spec decisão 2): HIBP por k-anonymity — só os 5 primeiros caracteres do SHA-1 saem
// do servidor, com padding. Se o HIBP não responder, cai para a lista local de senhas óbvias.
// Pendência registrada: trocar a lista curta pela lista local das 100 mil mais comuns.
const OBVIAS = new Set([
  '123456789012', '1234567890123', 'qwertyuiopas', 'senhasenha12', 'senha1234567', 'password1234',
  'administrador', 'licitacao123', 'licitacoes123', 'brasil123456', 'mudar123456', 'trocar123456',
]);

export type Buscador = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'text'>>;

// Avisa quem chama que o HIBP não respondeu (log/métrica sem prefixo nem senha).
export type AoFalharHibp = () => void;

export async function senhaVazada(
  senha: string,
  urlHibp: string,
  buscar: Buscador = fetch,
  aoFalhar: AoFalharHibp = () => undefined,
): Promise<boolean> {
  const minuscula = senha.toLowerCase();
  if (OBVIAS.has(minuscula) || /^(.)\1+$/.test(senha) || /^(?:0123456789|1234567890)+/.test(senha)) return true;
  if (!urlHibp) return false;
  const sha1 = createHash('sha1').update(senha).digest('hex').toUpperCase();
  try {
    const r = await buscar(`${urlHibp}${sha1.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'VV-Licitacoes' },
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) {
      aoFalhar();
      return false;
    }
    const sufixo = sha1.slice(5);
    return (await r.text()).split('\n').some((linha) => {
      const [suf, n] = linha.trim().split(':');
      return suf === sufixo && Number(n) > 0;
    });
  } catch {
    aoFalhar();
    return false;
  }
}

// CAPTCHA (spec decisão 4): Turnstile só a partir da 3ª falha por e-mail ou por IP, em 15 min.
// Sem segredo configurado (dev/teste), desligado. Contagem em memória: uma instância de API (ADR-015).
export class ContadorFalhas {
  private readonly falhas = new Map<string, number[]>();

  registrar(chave: string, agora = Date.now()): void {
    const lista = this.recentes(chave, agora);
    lista.push(agora);
    this.falhas.set(chave, lista);
    if (this.falhas.size > 10_000) {
      for (const [k, v] of this.falhas) if (v.every((t) => agora - t > 15 * 60_000)) this.falhas.delete(k);
    }
  }

  limpar(chave: string): void {
    this.falhas.delete(chave);
  }

  quantas(chave: string, agora = Date.now()): number {
    return this.recentes(chave, agora).length;
  }

  private recentes(chave: string, agora: number): number[] {
    return (this.falhas.get(chave) ?? []).filter((t) => agora - t < 15 * 60_000);
  }
}

export async function captchaValido(
  segredo: string,
  resposta: string | undefined,
  ip: string | null,
  buscar: Buscador = fetch,
): Promise<boolean> {
  if (!resposta) return false;
  const corpo = new URLSearchParams({ secret: segredo, response: resposta });
  if (ip) corpo.set('remoteip', ip);
  try {
    const r = await buscar('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: corpo,
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return false;
    return (JSON.parse(await r.text()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
