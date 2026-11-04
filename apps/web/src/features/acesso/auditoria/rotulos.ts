export interface Registro {
  id: string
  em: string
  autor: string | null
  tabela: string
  operacao: 'INSERT' | 'UPDATE' | 'DELETE' | string
  registro: string | null
  campos: string[] | null
}

const TABELAS: Record<string, string> = {
  empresas: 'Empresa',
  usuarios: 'Usuário',
  vinculos: 'Vínculo de usuário',
  permissoes: 'Permissão',
  convites: 'Convite',
  sessoes: 'Acesso (sessão)',
  fatores_mfa: 'Autenticador (MFA)',
  codigos_recuperacao: 'Códigos de recuperação',
  step_up_tokens: 'Confirmação de operação crítica',
  aprovacoes_exclusao: 'Exclusão definitiva',
}
const OPERACOES: Record<string, string> = { INSERT: 'Criou', UPDATE: 'Alterou', DELETE: 'Apagou' }

export const rotuloTabela = (t: string) => TABELAS[t] ?? t
export const rotuloOperacao = (o: string) => OPERACOES[o] ?? o

// O autor vem como id. Quem for da empresa aparece pelo nome; sem autor é o sistema (worker, função).
export function nomeDoAutor(autor: string | null, nomes: Map<string, string>): string {
  if (!autor) return 'Sistema'
  return nomes.get(autor) ?? 'Outro usuário'
}

export function descricao(r: Registro): string {
  const campos = r.operacao === 'UPDATE' && r.campos && r.campos.length > 0 ? ` (${r.campos.join(', ')})` : ''
  return `${rotuloOperacao(r.operacao)} ${rotuloTabela(r.tabela).toLowerCase()}${campos}`
}
