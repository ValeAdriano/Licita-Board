import { describe, expect, it } from 'vitest'
import { cnpjLegivel, cnpjValido, normalizarCnpj } from './cnpj'

describe('cnpj', () => {
  it('valida o dígito verificador, numérico e alfanumérico (exemplo oficial da Receita)', () => {
    expect(cnpjValido('11222333000181')).toBe(true)
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('12ABC34501DE35')).toBe(true)
    expect(cnpjValido('12abc34501de35')).toBe(true)
    expect(cnpjValido('11222333000182')).toBe(false)
    expect(cnpjValido('12ABC34501DE36')).toBe(false)
  })

  it('recusa tamanho errado, letra nos dígitos verificadores e repetição', () => {
    expect(cnpjValido('')).toBe(false)
    expect(cnpjValido('1122233300018')).toBe(false)
    expect(cnpjValido('12ABC34501DEAB')).toBe(false)
    expect(cnpjValido('00000000000000')).toBe(false)
  })

  it('normaliza e formata', () => {
    expect(normalizarCnpj(' 11.222.333/0001-81 ')).toBe('11222333000181')
    expect(cnpjLegivel('11222333000181')).toBe('11.222.333/0001-81')
    expect(cnpjLegivel('curto')).toBe('curto')
  })
})
