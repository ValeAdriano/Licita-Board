// Ambiente atual do front. Qualquer valor diferente de "prod" mostra a faixa de desenvolvimento.
export type AppEnv = 'dev' | 'homolog' | 'prod'

export function getAppEnv(raw: string | undefined = import.meta.env.VITE_ENV): AppEnv {
  if (raw === 'prod' || raw === 'homolog') return raw
  return 'dev'
}

export const appEnv = getAppEnv()
