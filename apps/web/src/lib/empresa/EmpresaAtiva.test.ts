import { describe, expect, it } from 'vitest'
import { escolherAtiva, nomeDaEmpresa } from './EmpresaAtiva'

const a = { id: 'a', razao_social: 'Alfa Ltda', nome_fantasia: 'Alfa' }
const b = { id: 'b', razao_social: 'Beta Ltda', nome_fantasia: null }

describe('escolherAtiva', () => {
  it('mantém a escolha se a empresa continua acessível', () => {
    expect(escolherAtiva([a, b], 'b')).toBe(b)
  })
  it('acesso revogado: cai para a primeira empresa acessível', () => {
    expect(escolherAtiva([a], 'b')).toBe(a)
  })
  it('sem empresas, nenhuma ativa', () => {
    expect(escolherAtiva([], 'a')).toBeNull()
  })
})

describe('nomeDaEmpresa', () => {
  it('usa o nome fantasia e cai para a razão social', () => {
    expect(nomeDaEmpresa(a)).toBe('Alfa')
    expect(nomeDaEmpresa(b)).toBe('Beta Ltda')
  })
})
