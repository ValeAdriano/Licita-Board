// Funções puras das telas de acesso (testadas sem renderizar).

// O link do e-mail traz o token no fragmento (`#token=...`): o fragmento não vai ao servidor nem no
// Referer. Aceita a URL inteira ou só o fragmento.
export function tokenDoFragmento(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf('#');
  const frag = i >= 0 ? url.slice(i + 1) : '';
  const token = new URLSearchParams(frag).get('token');
  return token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
}

// Segredo da URI otpauth, em grupos de 4, para digitar no autenticador quando não dá para abrir o link.
export function segredoDaUri(uri: string): string {
  const m = /[?&]secret=([A-Z2-7]+)/i.exec(uri);
  return m?.[1] ? (m[1].toUpperCase().match(/.{1,4}/g) ?? []).join(' ') : '';
}

export const MINIMO_SENHA = 12;

export function problemaNaNovaSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < MINIMO_SENHA) return `A senha precisa de pelo menos ${MINIMO_SENHA} caracteres.`;
  if (senha !== confirmacao) return 'As senhas não conferem.';
  return null;
}
