import { type AppEnv, appEnv } from '../lib/env'

const LABELS: Record<Exclude<AppEnv, 'prod'>, string> = {
  dev: 'DESENVOLVIMENTO · dados fictícios',
  homolog: 'HOMOLOGAÇÃO · dados anonimizados',
}

// Faixa obrigatória (Prompt Mestre 0.2): todo ambiente fora de produção é identificado visualmente.
export function EnvBanner({ env = appEnv }: { env?: AppEnv }) {
  if (env === 'prod') return null
  const cor = env === 'dev' ? 'bg-faixa-dev' : 'bg-faixa-homolog'
  return (
    <div
      role="status"
      className={`sticky top-0 z-50 px-4 py-1 text-center text-xs font-bold tracking-wide text-white ${cor}`}
    >
      {LABELS[env]}
    </div>
  )
}
