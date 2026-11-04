import { describe, expect, it } from 'vitest'
import { moeda, problemas, type FonteEstado } from './formato'

const fonte = (p: Partial<FonteEstado>): FonteEstado => ({
  slug: 'pncp', nome: 'PNCP', status: 'ok', ativa: true, ultimoSucessoEm: '2026-11-04T10:00:00Z', ultimaPesquisaEm: null, ...p,
})
const agora = new Date('2026-11-04T12:00:00Z').getTime()

describe('moeda', () => {
  it('formata string decimal sem passar por number', () => {
    expect(moeda('177500.0000')).toBe('R$ 177.500,00')
    expect(moeda('0.5')).toBe('R$ 0,50')
    expect(moeda('1234567.8912')).toBe('R$ 1.234.567,89')
  })
  it('valor ausente vira traço', () => {
    expect(moeda(null)).toBe('—')
    expect(moeda('')).toBe('—')
  })
})

describe('problemas das fontes', () => {
  it('fonte saudável e recente não tem problema', () => {
    expect(problemas([fonte({})], agora)).toEqual([])
  })
  it('indisponível, degradada, nunca buscou ou busca antiga contam como problema', () => {
    expect(problemas([fonte({ status: 'indisponivel' })], agora)).toEqual(['PNCP'])
    expect(problemas([fonte({ status: 'degradada' })], agora)).toEqual(['PNCP'])
    expect(problemas([fonte({ ultimoSucessoEm: null })], agora)).toEqual(['PNCP'])
    expect(problemas([fonte({ ultimoSucessoEm: '2026-11-02T10:00:00Z' })], agora)).toEqual(['PNCP'])
  })
  it('fonte desligada não conta (nem esconde falha de outra)', () => {
    expect(problemas([fonte({ ativa: false, status: 'desativada', ultimoSucessoEm: null }), fonte({ slug: 'x', nome: 'X', status: 'indisponivel' })], agora)).toEqual(['X'])
  })
})
