import { describe, expect, it } from 'vitest'
import { decidirAcesso, exigeMfa } from './acesso'

const base = { temSessao: true, nivelAtual: 'aal1' as const, temFatorVerificado: false, mfaObrigatorio: true }

describe('decidirAcesso', () => {
  it('sem sessão vai para o login', () => {
    expect(decidirAcesso({ ...base, temSessao: false })).toBe('login')
  })
  it('perfil interno sem fator precisa cadastrar MFA', () => {
    expect(decidirAcesso(base)).toBe('cadastrar-mfa')
  })
  it('quem tem fator e está em aal1 precisa verificar, mesmo sendo CLIENTE', () => {
    expect(decidirAcesso({ ...base, temFatorVerificado: true })).toBe('verificar-mfa')
    expect(decidirAcesso({ ...base, temFatorVerificado: true, mfaObrigatorio: false })).toBe('verificar-mfa')
  })
  it('aal2 com fator libera', () => {
    expect(decidirAcesso({ ...base, temFatorVerificado: true, nivelAtual: 'aal2' })).toBe('liberado')
  })
  it('CLIENTE sem fator entra só com senha', () => {
    expect(decidirAcesso({ ...base, mfaObrigatorio: false })).toBe('liberado')
  })
})

describe('exigeMfa', () => {
  it('SUPERADMIN e perfis internos exigem', () => {
    expect(exigeMfa({ superadmin: true, papeis: [] })).toBe(true)
    expect(exigeMfa({ superadmin: false, papeis: ['OPERADOR'] })).toBe(true)
    expect(exigeMfa({ superadmin: false, papeis: ['CLIENTE', 'JURIDICO'] })).toBe(true)
  })
  it('só CLIENTE não exige', () => {
    expect(exigeMfa({ superadmin: false, papeis: ['CLIENTE'] })).toBe(false)
  })
  it('sem vínculo exige (falha fechado)', () => {
    expect(exigeMfa({ superadmin: false, papeis: [] })).toBe(true)
  })
})
