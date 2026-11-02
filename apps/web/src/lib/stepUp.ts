import { mensagemDeErro } from './auth/erros'
import { supabase } from './supabase'

export type EscopoStepUp = 'alterar_permissoes' | 'exclusao_definitiva' | 'preco_abaixo_minimo' | 'proposta_final' | 'aprovar_peca'

/** Mensagem clara para os bloqueios de concessão do banco (teto, autoconcessão, CLIENTE, lockout). */
export function mensagemBloqueioPermissao(mensagem: string | undefined): string | null {
  if (!mensagem) return null
  if (mensagem.includes('próprias permissões')) return 'Você não pode ampliar as próprias permissões. Peça a outro administrador.'
  if (mensagem.includes('você mesmo tem')) return 'Você só pode conceder permissões que você mesmo tem nesta empresa.'
  if (mensagem.includes('sem nenhum administrador')) return 'A empresa precisa manter ao menos um administrador de permissões.'
  if (mensagem.includes('CLIENTE só pode')) return 'Cliente é somente leitura: só a ação Visualizar é permitida.'
  if (mensagem.includes('limite de convites')) return 'Limite diário de convites desta empresa atingido. Tente amanhã.'
  return null
}

export type ResultadoStepUp = { token: string; erro?: undefined } | { token?: undefined; erro: string }

/**
 * Reautenticação para operação crítica (Prompt 1.4; spec 3.1): verifica um código TOTP novo e troca
 * a verificação por um token de uso único (5 min). Cada operação crítica pede um código novo.
 */
export async function obterStepUp(fatorId: string, codigo: string, escopo: EscopoStepUp): Promise<ResultadoStepUp> {
  const verificacao = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo })
  if (verificacao.error) return { erro: mensagemDeErro(verificacao.error) }

  const { data, error } = await supabase.schema('core').rpc('iniciar_step_up', { p_escopo: escopo })
  if (error) {
    if (error.message?.includes('24 h')) {
      return { erro: 'Autenticador cadastrado há menos de 24 h não autoriza esta operação. Tente amanhã ou use o autenticador antigo.' }
    }
    return { erro: 'Não foi possível confirmar a reautenticação. Tente de novo.' }
  }
  return { token: data as string }
}
