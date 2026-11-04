export interface EmpresaPlataforma {
  id: string
  razaoSocial: string
  nomeFantasia: string | null
  cnpj: string
}

export type StatusExclusao = 'pendente' | 'executada' | 'rejeitada' | 'expirada'

export interface PedidoExclusao {
  id: string
  tabela: string
  alvoId: string
  motivo: string
  status: StatusExclusao
  solicitadoPor: string
  solicitadoEm: string
  expiraEm: string
  resumo: { razao_social?: string; cnpj?: string } | null
}

export const rotuloStatus: Record<StatusExclusao, string> = {
  pendente: 'Aguardando segunda aprovação',
  executada: 'Excluída',
  rejeitada: 'Rejeitada',
  expirada: 'Expirada',
}

// Quem pode decidir: outro SUPERADMIN (o banco recusa o próprio solicitante) e só enquanto vale (72 h).
export function podeDecidir(p: PedidoExclusao, usuarioId: string | undefined, agora = Date.now()): boolean {
  return p.status === 'pendente' && p.solicitadoPor !== usuarioId && new Date(p.expiraEm).getTime() > agora
}
