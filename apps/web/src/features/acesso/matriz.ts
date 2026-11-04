// Matriz de permissões (Prompt 1.3): empresa × módulo × 12 ações, negar por padrão. As sugestões por
// papel só PRÉ-PREENCHEM a tela (spec fase-01, decisão 14); nada é implícito no banco. Regras da
// revisão 1, sem mudança.

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
export interface Modulo {
  slug: string
  nome: string
}

export const PAPEIS: { id: Papel; rotulo: string }[] = [
  { id: 'ADMIN_EMPRESA', rotulo: 'Administrador da empresa' },
  { id: 'OPERADOR', rotulo: 'Operador' },
  { id: 'JURIDICO', rotulo: 'Jurídico' },
  { id: 'CLIENTE', rotulo: 'Cliente (somente leitura)' },
]

export const rotuloPapel = (p: string) => (p === 'SUPERADMIN' ? 'Equipe da plataforma' : (PAPEIS.find((x) => x.id === p)?.rotulo ?? p))
export const chave = (modulo: string, acao: string) => `${modulo}:${acao}`
const acaoDe = (k: string) => k.split(':')[1] ?? ''

/** Ações que o papel pode receber. CLIENTE é somente leitura (o banco também barra). */
export function acaoPermitida(papel: Papel, acao: string): boolean {
  return papel !== 'CLIENTE' || acao === 'visualizar'
}

const SO_ADMIN = new Set(['permissoes', 'auditoria'])
const SENSIVEIS_OPERADOR = new Set<string>(['ver_custos_margens', 'administrar_permissoes', 'aprovar_peca'])
const VISIVEIS_CLIENTE = new Set(['empresas', 'documentos', 'agenda', 'editais', 'produtos'])
const ACOES_JURIDICO = ['cadastrar', 'editar', 'elaborar_peca', 'aprovar_peca', 'gerar_documentos']

/** Sugestão inicial por papel. Sempre editável e revisada por quem administra. */
export function sugestaoPorPapel(papel: Papel, modulos: Modulo[]): Set<string> {
  const s = new Set<string>()
  for (const m of modulos) {
    for (const { id: acao } of ACOES) {
      const marcar =
        papel === 'ADMIN_EMPRESA' ||
        (papel === 'OPERADOR' && !SO_ADMIN.has(m.slug) && !SENSIVEIS_OPERADOR.has(acao)) ||
        (papel === 'JURIDICO' && (acao === 'visualizar' || (m.slug === 'juridico' && ACOES_JURIDICO.includes(acao)))) ||
        (papel === 'CLIENTE' && acao === 'visualizar' && VISIVEIS_CLIENTE.has(m.slug))
      if (marcar) s.add(chave(m.slug, acao))
    }
  }
  return s
}

/** Remove o que o papel não pode ter (ex.: ao trocar para CLIENTE). */
export function filtrarPorPapel(papel: Papel, selecao: Set<string>): Set<string> {
  return new Set([...selecao].filter((k) => acaoPermitida(papel, acaoDe(k))))
}

export function iguais(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

/** Alterna uma permissão (devolve um conjunto novo). */
export function alternar(selecao: Set<string>, modulo: string, acao: string): Set<string> {
  const novo = new Set(selecao)
  const k = chave(modulo, acao)
  if (novo.has(k)) novo.delete(k)
  else novo.add(k)
  return novo
}

/** Ações que ampliam poder (não só leitura): a confirmação as lista pelo nome, não só em contagem. */
export const ACOES_SENSIVEIS = ['administrar_permissoes', 'ver_custos_margens', 'aprovar_peca', 'aprovar', 'exportar'] as const

/** "Concede <ação> em: <módulos>" para cada ação sensível acrescentada (nada se não houver). */
export function concessoesSensiveis(antes: Set<string>, depois: Set<string>, modulos: Modulo[]): string[] {
  const nome = (slug: string) => modulos.find((m) => m.slug === slug)?.nome ?? slug
  const linhas: string[] = []
  for (const acao of ACOES_SENSIVEIS) {
    const novos = [...depois].filter((k) => !antes.has(k) && k.endsWith(`:${acao}`)).map((k) => nome(k.split(':')[0] ?? ''))
    if (novos.length > 0) linhas.push(`Concede ${ACOES.find((a) => a.id === acao)?.rotulo ?? acao} em: ${novos.join(', ')}`)
  }
  return linhas
}

/** Linhas de resumo para a confirmação: o usuário vê o que está concedendo antes de digitar o código. */
export function resumoMudanca(antes: Set<string>, depois: Set<string>): string[] {
  const novas = [...depois].filter((k) => !antes.has(k)).length
  const removidas = [...antes].filter((k) => !depois.has(k)).length
  return [`Permissões: +${novas} · −${removidas} (total ${depois.size})`]
}
