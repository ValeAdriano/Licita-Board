// CNPJ numérico ou alfanumérico (14 caracteres, os dois últimos são dígitos verificadores). Só ajuda
// a pessoa a digitar certo: quem decide é o banco (`core.cnpj_valido`).
export const normalizarCnpj = (texto: string): string => texto.toUpperCase().replace(/[^0-9A-Z]/g, '')

const valor = (c: string): number => c.charCodeAt(0) - 48

function digito(base: string): number {
  let soma = 0
  let peso = 2
  for (let i = base.length - 1; i >= 0; i--) {
    soma += valor(base.charAt(i)) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function cnpjValido(texto: string): boolean {
  const c = normalizarCnpj(texto)
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false
  return digito(c.slice(0, 12)) === Number(c.charAt(12)) && digito(c.slice(0, 13)) === Number(c.charAt(13))
}

export function cnpjLegivel(cnpj: string): string {
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}` : cnpj
}
