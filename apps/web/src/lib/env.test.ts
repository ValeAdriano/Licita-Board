import { describe, expect, it } from 'vitest'
import { getAppEnv } from './env'

describe('getAppEnv', () => {
  it('reconhece prod e homolog', () => {
    expect(getAppEnv('prod')).toBe('prod')
    expect(getAppEnv('homolog')).toBe('homolog')
  })

  it('qualquer outro valor cai em dev (falha segura: mostra a faixa)', () => {
    expect(getAppEnv(undefined)).toBe('dev')
    expect(getAppEnv('production')).toBe('dev')
    expect(getAppEnv('')).toBe('dev')
  })
})
