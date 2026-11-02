import { describe, expect, it } from 'vitest'
import { acaoPermitida, filtrarPorPapel, iguais, sugestaoPorPapel } from './matriz'

const modulos = [
  { slug: 'empresas', nome: 'Empresas' },
  { slug: 'permissoes', nome: 'Permissões' },
  { slug: 'juridico', nome: 'Jurídico' },
  { slug: 'precos', nome: 'Preços' },
]

describe('sugestaoPorPapel', () => {
  it('ADMIN_EMPRESA recebe tudo', () => {
    expect(sugestaoPorPapel('ADMIN_EMPRESA', modulos).size).toBe(4 * 12)
  })
  it('OPERADOR não administra permissões nem vê custos', () => {
    const s = sugestaoPorPapel('OPERADOR', modulos)
    expect(s.has('permissoes:visualizar')).toBe(false)
    expect(s.has('precos:ver_custos_margens')).toBe(false)
    expect(s.has('empresas:editar')).toBe(true)
  })
  it('JURÍDICO visualiza tudo e elabora/aprova peças', () => {
    const s = sugestaoPorPapel('JURIDICO', modulos)
    expect(s.has('precos:visualizar')).toBe(true)
    expect(s.has('juridico:aprovar_peca')).toBe(true)
    expect(s.has('precos:editar')).toBe(false)
  })
  it('CLIENTE só visualiza módulos liberados', () => {
    const s = sugestaoPorPapel('CLIENTE', modulos)
    expect([...s]).toEqual(['empresas:visualizar'])
  })
})

describe('regras do CLIENTE', () => {
  it('só visualizar é permitido', () => {
    expect(acaoPermitida('CLIENTE', 'visualizar')).toBe(true)
    expect(acaoPermitida('CLIENTE', 'editar')).toBe(false)
    expect(acaoPermitida('OPERADOR', 'editar')).toBe(true)
  })
  it('trocar para CLIENTE remove ações de escrita', () => {
    const r = filtrarPorPapel('CLIENTE', new Set(['empresas:visualizar', 'empresas:editar']))
    expect(iguais(r, new Set(['empresas:visualizar']))).toBe(true)
  })
})
