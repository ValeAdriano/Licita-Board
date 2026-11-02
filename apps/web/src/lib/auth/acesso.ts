// Decide para onde mandar o usuário. Função pura, testada em acesso.test.ts.
// O banco é quem garante a regra (RLS exige aal2 para perfis internos); aqui é só a navegação.

export type EstadoAcesso = {
  temSessao: boolean
  nivelAtual: 'aal1' | 'aal2' | null
  temFatorVerificado: boolean
  mfaObrigatorio: boolean
}

export type Destino = 'login' | 'cadastrar-mfa' | 'verificar-mfa' | 'liberado'

export function decidirAcesso(e: EstadoAcesso): Destino {
  if (!e.temSessao) return 'login'
  if (e.temFatorVerificado && e.nivelAtual !== 'aal2') return 'verificar-mfa'
  if (e.mfaObrigatorio && !e.temFatorVerificado) return 'cadastrar-mfa'
  return 'liberado'
}

// MFA obrigatório para SUPERADMIN, ADMIN_EMPRESA, OPERADOR e JURÍDICO (Prompt 1.4).
// CLIENTE pode usar só senha; sem vínculo nenhum também exige, por segurança (falha fechado).
export function exigeMfa(perfil: { superadmin: boolean; papeis: string[] }): boolean {
  if (perfil.superadmin) return true
  if (perfil.papeis.length === 0) return true
  return perfil.papeis.some((p) => p !== 'CLIENTE')
}
