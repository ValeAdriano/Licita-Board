import type { Papel } from '../matriz';

export interface Membro {
  vinculoId: string;
  usuarioId: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  permissoes: string[];
}

export interface ConviteEmpresa {
  id: string;
  email: string;
  papel: Papel;
  permissoes: string[];
  criadoEm: string;
  expiraEm: string;
  aceitoEm: string | null;
  revogadoEm: string | null;
}

// Pendente = nem aceito, nem revogado, nem vencido (a API ainda confere tudo ao aceitar).
export function convitePendente(c: ConviteEmpresa, agora = Date.now()): boolean {
  return !c.aceitoEm && !c.revogadoEm && new Date(c.expiraEm).getTime() > agora;
}
