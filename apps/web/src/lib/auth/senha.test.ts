import { describe, expect, it } from 'vitest'
import { novaSenhaSchema } from './senha'
import { MENSAGEM_LOGIN_INVALIDO, mensagemDeErro } from './erros'

describe('novaSenhaSchema', () => {
  it('aceita senha forte confirmada', () => {
    expect(novaSenhaSchema.safeParse({ senha: 'Licitacao2026', confirmacao: 'Licitacao2026' }).success).toBe(true)
  })
  it.each([
    ['curta', 'Abc12345'],
    ['sem maiúscula', 'licitacao2026'],
    ['sem minúscula', 'LICITACAO2026'],
    ['sem número', 'LicitacaoForte'],
  ])('rejeita senha %s', (_, senha) => {
    expect(novaSenhaSchema.safeParse({ senha, confirmacao: senha }).success).toBe(false)
  })
  it('rejeita confirmação diferente', () => {
    const r = novaSenhaSchema.safeParse({ senha: 'Licitacao2026', confirmacao: 'Licitacao2027' })
    expect(r.success).toBe(false)
  })
})

describe('mensagemDeErro', () => {
  it('login não revela se o e-mail existe', () => {
    expect(mensagemDeErro({ code: 'invalid_credentials' })).toBe(MENSAGEM_LOGIN_INVALIDO)
    expect(mensagemDeErro({ code: 'user_not_found' })).toBe(MENSAGEM_LOGIN_INVALIDO)
    expect(mensagemDeErro({ code: 'email_not_confirmed' })).toBe(MENSAGEM_LOGIN_INVALIDO)
  })
  it('limite de tentativas tem mensagem própria', () => {
    expect(mensagemDeErro({ status: 429 })).toMatch(/Muitas tentativas/)
  })
  it('erro desconhecido não vaza detalhe técnico', () => {
    expect(mensagemDeErro({ message: 'relation "core.x" does not exist' })).not.toMatch(/relation/)
  })
})
