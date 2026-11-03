import type { Ambiente } from '../config'

// Faixa fixa fora de produção (Prompt Mestre 0.2, ADR-015): ninguém confunde teste com dado real.
const TEXTOS: Record<Exclude<Ambiente, 'prod'>, string> = { dev: 'DESENVOLVIMENTO', homolog: 'HOMOLOGAÇÃO' }

export function FaixaAmbiente({ ambiente }: { ambiente: Ambiente }) {
  if (ambiente === 'prod') return null
  return (
    <div role="alert" className={`faixa-ambiente faixa-ambiente--${ambiente}`}>
      {TEXTOS[ambiente]}
    </div>
  )
}
