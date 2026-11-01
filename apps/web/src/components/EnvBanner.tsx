import { type AppEnv, appEnv } from '../lib/env'

const LABELS: Record<Exclude<AppEnv, 'prod'>, string> = {
  dev: 'DESENVOLVIMENTO · dados fictícios',
  homolog: 'HOMOLOGAÇÃO · dados anonimizados',
}

// Faixa obrigatória (Prompt Mestre 0.2): todo ambiente fora de produção é identificado visualmente.
export function EnvBanner({ env = appEnv }: { env?: AppEnv }) {
  if (env === 'prod') return null
  return (
    <div role="status" className={`env-banner env-banner--${env}`}>
      {LABELS[env]}
    </div>
  )
}
