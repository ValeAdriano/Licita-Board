// Matriz de permissões (Prompt 1.3): empresa × módulo × 12 ações, negar por padrão.
// As sugestões por papel só PRÉ-PREENCHEM a tela (spec fase-01, pergunta 1); nada é implícito no banco.

export const ACOES = [
  { id: 'visualizar', rotulo: 'Visualizar' },
  { id: 'cadastrar', rotulo: 'Cadastrar' },
  { id: 'editar', rotulo: 'Editar' },
  { id: 'arquivar', rotulo: 'Arquivar' },
  { id: 'substituir_arquivos', rotulo: 'Substituir arquivos' },
  { id: 'gerar_documentos', rotulo: 'Gerar documentos' },
  { id: 'ver_custos_margens', rotulo: 'Ver custos e margens' },
  { id: 'elaborar_peca', rotulo: 'Elaborar peça jurídica' },
  { id: 'aprovar_peca', rotulo: 'Aprovar peça jurídica' },
  { id: 'aprovar', rotulo: 'Aprovar' },
  { id: 'exportar', rotulo: 'Exportar' },
  { id: 'administrar_permissoes', rotulo: 'Administrar permissões' },
] as const

export type Acao = (typeof ACOES)[number]['id']
export type Papel = 'ADMIN_EMPRESA' | 'OPERADOR' | 'JURIDICO' | 'CLIENTE'
export type Modulo = { slug: string; nome: string }

export const PAPEIS: { id: Papel; rotulo: string }[] = [
  { id: 'ADMIN_EMPRESA', rotulo: 'Administrador da empresa' },
  { id: 'OPERADOR', rotulo: 'Operador' },
  { id: 'JURIDICO', rotulo: 'Jurídico' },
  { id: 'CLIENTE', rotulo: 'Cliente (somente leitura)' },
]

export const chave = (modulo: string, acao: string) => `${modulo}:${acao}`

/** Ações que o papel pode receber. CLIENTE é somente leitura (o banco também barra). */
export function acaoPermitida(papel: Papel, acao: Acao): boolean {
  return papel !== 'CLIENTE' || acao === 'visualizar'
}

const SO_ADMIN = new Set(['permissoes', 'auditoria'])
const SENSIVEIS_OPERADOR = new Set<Acao>(['ver_custos_margens', 'administrar_permissoes', 'aprovar_peca'])
const VISIVEIS_CLIENTE = new Set(['empresas', 'documentos', 'agenda', 'editais', 'produtos'])

/** Sugestão inicial por papel. Sempre editável e revisada por quem administra. */
export function sugestaoPorPapel(papel: Papel, modulos: Modulo[]): Set<string> {
  const s = new Set<string>()
  for (const m of modulos) {
    for (const { id: acao } of ACOES) {
      const marcar =
        papel === 'ADMIN_EMPRESA' ||
        (papel === 'OPERADOR' && !SO_ADMIN.has(m.slug) && !SENSIVEIS_OPERADOR.has(acao)) ||
        (papel === 'JURIDICO' && (acao === 'visualizar' || (m.slug === 'juridico' && ['cadastrar', 'editar', 'elaborar_peca', 'aprovar_peca', 'gerar_documentos'].includes(acao)))) ||
        (papel === 'CLIENTE' && acao === 'visualizar' && VISIVEIS_CLIENTE.has(m.slug))
      if (marcar) s.add(chave(m.slug, acao))
    }
  }
  return s
}

/** Remove o que o papel não pode ter (ex.: ao trocar para CLIENTE). */
export function filtrarPorPapel(papel: Papel, selecao: Set<string>): Set<string> {
  return new Set([...selecao].filter((k) => acaoPermitida(papel, k.split(':')[1] as Acao)))
}

export function iguais(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}
