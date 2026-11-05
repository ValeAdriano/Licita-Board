import { describe, expect, it } from 'vitest'
import { ehDecimal, paraDecimal, pct, reais, semZeros } from './formato'

describe('formatação de preços (sem number)', () => {
  it('formata reais com milhar e as casas pedidas, sem arredondar por ponto flutuante', () => {
    expect(reais('1234567.8')).toBe('R$ 1.234.567,80')
    expect(reais('0.005', 2)).toBe('R$ 0,00')
    expect(reais('125.000000', 4)).toBe('R$ 125,0000')
    expect(reais('-10.5')).toBe('-R$ 10,50')
    expect(reais(null)).toBe('—')
  })
  it('percentual sem zeros à direita', () => {
    expect(pct('20.0000')).toBe('20%')
    expect(pct('12.5000')).toBe('12,5%')
    expect(pct(null)).toBe('—')
  })
  it('tira zeros só da parte decimal', () => {
    expect([semZeros('10.0000'), semZeros('10'), semZeros('1.5000'), semZeros('100')]).toEqual(['10', '10', '1.5', '100'])
  })
  it('converte o que a pessoa digita em pt-BR para a string decimal da API', () => {
    expect(paraDecimal('1.234,50')).toBe('1234.50')
    expect(paraDecimal(' 12,5 ')).toBe('12.5')
    expect(paraDecimal('1.5')).toBe('1.5') // ponto sem vírgula é decimal
    expect(ehDecimal('12,5')).toBe(true)
    expect(ehDecimal('1.234,50')).toBe(true)
    expect(ehDecimal('1.5')).toBe(true)
    expect(ehDecimal('12,12345')).toBe(false)
    expect(ehDecimal('abc')).toBe(false)
  })
})
