// Variáveis EXPO_PUBLIC_* são embutidas no bundle público: aqui só entra o que pode ser visto.
export type Ambiente = 'dev' | 'homolog' | 'prod';

function ambiente(valor: string | undefined): Ambiente {
  return valor === 'prod' || valor === 'homolog' ? valor : 'dev';
}

export const AMBIENTE: Ambiente = ambiente(process.env.EXPO_PUBLIC_VV_ENV);

// No emulador Android, "localhost" é o próprio emulador: use EXPO_PUBLIC_API_URL=http://10.0.2.2:3000.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// Fora de dev o app só fala com a API por https (o token vai em cada requisição).
if (AMBIENTE !== 'dev' && !API_URL.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_API_URL precisa ser https fora de dev');
}

// Chave pública do Turnstile (CAPTCHA a partir da 3ª falha). Sem ela, o app avisa para tentar depois.
export const TURNSTILE_SITEKEY = process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY ?? '';
