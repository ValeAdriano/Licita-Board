import { describe, expect, it } from 'vitest'
import { descricao, nomeDoAutor, rotuloTabela } from './rotulos'

const base = { id: '1', em: '2026-11-04T12:00:00Z', autor: null, registro: null }

describe('rótulos da auditoria', () => {
  it('descreve a operação em português, com os campos alterados', () => {
    expect(descricao({ ...base, tabela: 'empresas', operacao: 'UPDATE', campos: ['nome_fantasia'] })).toBe('Alterou empresa (nome_fantasia)')
    expect(descricao({ ...base, tabela: 'convites', operacao: 'INSERT', campos: null })).toBe('Criou convite')
    expect(descricao({ ...base, tabela: 'tabela_nova', operacao: 'DELETE', campos: [] })).toBe('Apagou tabela_nova')
  })

  it('autor: nome da equipe, "Sistema" sem autor e "Outro usuário" para quem não é da lista', () => {
    const nomes = new Map([['u1', 'Ana']])
    expect(nomeDoAutor('u1', nomes)).toBe('Ana')
    expect(nomeDoAutor(null, nomes)).toBe('Sistema')
    expect(nomeDoAutor('u9', nomes)).toBe('Outro usuário')
    expect(rotuloTabela('sessoes')).toBe('Acesso (sessão)')
  })
})
