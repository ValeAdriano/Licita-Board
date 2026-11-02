// Traduz erros do Supabase Auth para mensagens em português.
// Login e recuperação usam mensagens NEUTRAS: nunca revelam se o e-mail existe (Prompt 1.4).

type ErroAuth = { code?: string; message?: string; status?: number } | null | undefined

export const MENSAGEM_LOGIN_INVALIDO = 'E-mail ou senha inválidos.'

export function mensagemDeErro(erro: ErroAuth): string {
  const code = erro?.code ?? ''
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || erro?.status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
  }
  if (code === 'weak_password') {
    return 'Senha fraca ou já exposta em vazamentos conhecidos. Escolha outra.'
  }
  if (code === 'same_password') return 'A nova senha precisa ser diferente da atual.'
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired') {
    return 'Código inválido ou expirado. Confira o horário do celular e tente de novo.'
  }
  if (code === 'insufficient_aal') return 'Confirme o código do autenticador para continuar.'
  if (code === 'session_not_found' || code === 'refresh_token_not_found') {
    return 'Sua sessão expirou. Entre de novo.'
  }
  if (code === 'invalid_credentials' || code === 'email_not_confirmed' || code === 'user_not_found') {
    return MENSAGEM_LOGIN_INVALIDO
  }
  return 'Não foi possível concluir agora. Tente de novo em instantes.'
}
