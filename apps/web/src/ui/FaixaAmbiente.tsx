import type { Ambiente } from '../config'

// Faixa fixa fora de produção (Prompt Mestre 0.2, ADR-015): ninguém confunde teste com dado real.
const TEXTOS: Record<Exclude<Ambiente, 'prod'>, string> = { dev: 'DESENVOLVIMENTO', homolog: 'HOMOLOGAÇÃO' }
const COR: Record<Exclude<Ambiente, 'prod'>, string> = { dev: 'bg-utility-orange-700', homolog: 'bg-utility-purple-700' }

export function FaixaAmbiente({ ambiente }: { ambiente: Ambiente }) {
  if (ambiente === 'prod') return null
  return (
    <div role="alert" className={`fixed inset-x-0 top-0 z-50 h-6 text-center text-xs leading-6 font-bold tracking-widest text-white ${COR[ambiente]}`}>
      {TEXTOS[ambiente]}
    </div>
  )
}
