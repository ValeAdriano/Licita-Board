import { describe, expect, it } from 'vitest'
import { linkInterno } from './notificacoes'

describe('linkInterno', () => {
  it.each(['/agenda', '/editais?id=01a1990c', '/'])('aceita caminho interno %s', (l) => {
    expect(linkInterno(l)).toBe(l)
  })
  it.each(['//evil.example', '/\\evil', 'https://evil.example', '/..//x', '/a//b', 'javascript:alert(1)', '/%2F%2Fevil'])(
    'recusa %s',
    (l) => {
      expect(linkInterno(l)).toBeNull()
    },
  )
})
