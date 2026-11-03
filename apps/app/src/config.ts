// Variáveis EXPO_PUBLIC_* são embutidas no bundle público: aqui só entra o que pode ser visto.
export type Ambiente = 'dev' | 'homolog' | 'prod';

function ambiente(valor: string | undefined): Ambiente {
  return valor === 'prod' || valor === 'homolog' ? valor : 'dev';
}

export const AMBIENTE: Ambiente = ambiente(process.env.EXPO_PUBLIC_VV_ENV);

// No emulador Android, "localhost" é o próprio emulador: use EXPO_PUBLIC_API_URL=http://10.0.2.2:3000.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
