import { describe, expect, it } from 'vitest'
import { problemaNaNovaSenha, segredoDaUri, tokenDoFragmento } from './links'
import { expirou, INATIVIDADE_MS } from './sessao'

const TOKEN = 'a'.repeat(43)

describe('tokenDoFragmento', () => {
  it('lê o token do fragmento da URL ou do hash', () => {
    expect(tokenDoFragmento(`https://app.vv/redefinir-senha#token=${TOKEN}`)).toBe(TOKEN)
    expect(tokenDoFragmento(`#token=${TOKEN}`)).toBe(TOKEN)
  })

  it('ignora token na query, ausente ou com formato estranho', () => {
    expect(tokenDoFragmento(`https://app.vv/redefinir-senha?token=${TOKEN}`)).toBeNull()
    expect(tokenDoFragmento(null)).toBeNull()
    expect(tokenDoFragmento('#token=curto')).toBeNull()
    expect(tokenDoFragmento(`#token=${'a'.repeat(42)}<script>`)).toBeNull()
  })
})

describe('segredoDaUri', () => {
  it('extrai o segredo em grupos de 4', () => {
    expect(segredoDaUri('otpauth://totp/VV:a%40b?secret=JBSWY3DPEHPK3PXP&issuer=VV')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(segredoDaUri('otpauth://totp/VV:a')).toBe('')
  })
})

describe('problemaNaNovaSenha', () => {
  it('exige 12 caracteres e confirmação igual', () => {
    expect(problemaNaNovaSenha('curta', 'curta')).toMatch(/12 caracteres/)
    expect(problemaNaNovaSenha('senha-longa-123', 'outra-senha-123')).toBe('As senhas não conferem.')
    expect(problemaNaNovaSenha('senha-longa-123', 'senha-longa-123')).toBeNull()
  })
})

describe('expirou', () => {
  it('encerra com 30 min sem uso', () => {
    expect(expirou(0, INATIVIDADE_MS - 1)).toBe(false)
    expect(expirou(0, INATIVIDADE_MS)).toBe(true)
  })
})
