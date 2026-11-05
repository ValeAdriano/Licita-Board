import { describe, expect, it } from 'vitest'
import { diaSP, grade, horaSP, inicioDaSemana, paraCampoLocal, paraIsoSP, somarDias, somarMeses } from './comum'

describe('datas da agenda (Brasília)', () => {
  it('o dia vale o de Brasília, não o de UTC', () => {
    expect(diaSP('2026-12-16T02:59:00Z')).toBe('2026-12-15') // 23:59 em Brasília
    expect(diaSP('2026-12-16T03:01:00Z')).toBe('2026-12-16') // 00:01 em Brasília
    expect(horaSP('2026-12-16T13:30:00Z')).toBe('10:30')
  })
  it('campo local <-> instante', () => {
    expect(paraIsoSP('2026-12-16T10:00')).toBe('2026-12-16T10:00:00-03:00')
    expect(paraCampoLocal('2026-12-16T13:00:00Z')).toBe('2026-12-16T10:00')
    expect(paraCampoLocal(null)).toBe('')
  })
  it('somar dias e meses cruza virada de mês e de ano', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28')
    expect(somarMeses('2026-12-15', 1)).toBe('2027-01-01')
    expect(somarMeses('2026-01-31', -1)).toBe('2025-12-01')
  })
  it('semana começa no domingo', () => {
    expect(inicioDaSemana('2026-12-16')).toBe('2026-12-13') // quarta -> domingo
  })
  it('grade do mês tem semanas completas de domingo a sábado', () => {
    const g = grade('2026-12-16')
    expect(g[0]?.[0]).toBe('2026-11-29')
    expect(g.at(-1)?.[6]).toBe('2027-01-02')
    expect(g.every((s) => s.length === 7)).toBe(true)
    expect(g.flat()).toContain('2026-12-31')
  })
})
