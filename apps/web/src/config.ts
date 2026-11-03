// Variáveis VITE_* são embutidas no bundle público: aqui só entra o que pode ser visto.
export type Ambiente = 'dev' | 'homolog' | 'prod'

const bruto = import.meta.env.VITE_VV_ENV
export const AMBIENTE: Ambiente = bruto === 'prod' || bruto === 'homolog' ? bruto : 'dev'

// Mesma origem por padrão: /api é o proxy do Vite em dev e o Caddy em produção (ADR-018).
export const API_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

// Chave pública do Turnstile (CAPTCHA a partir da 3ª falha). Sem ela, o app avisa para tentar depois.
export const TURNSTILE_SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY ?? ''

// Fora de dev a API é da mesma origem ou https (o cookie de sessão é Secure).
if (AMBIENTE !== 'dev' && API_URL.startsWith('http://')) {
  throw new Error('VITE_API_URL precisa ser https ou relativa fora de dev')
}
