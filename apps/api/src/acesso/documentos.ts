// CPF e CNPJ (numérico ou alfanumérico): normalização e dígito verificador. O banco confere de novo o
// CNPJ da empresa (core.cnpj_valido); aqui valem os que chegam CIFRADOS (titular da conta, chave PIX),
// que o banco não consegue ler.
export const soDigitos = (v: string): string => v.replace(/\D/g, '');
export const normalizarCnpj = (v: string): string => v.toUpperCase().replace(/[^0-9A-Z]/g, '');

export function cpfValido(texto: string): boolean {
  const c = soDigitos(texto);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number): number => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c.charAt(i)) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c.charAt(9)) && dv(10) === Number(c.charAt(10));
}

export function cnpjValido(texto: string): boolean {
  const c = normalizarCnpj(texto);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const dv = (base: string): number => {
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c.charAt(12)) && dv(c.slice(0, 13)) === Number(c.charAt(13));
}

export type PixTipo = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

// Valida a chave PIX pelo tipo e devolve a forma normalizada (a que vai cifrada e vira marca).
export function normalizarChavePix(tipo: PixTipo, chave: string): string | null {
  const v = chave.trim();
  switch (tipo) {
    case 'cpf':
      return cpfValido(v) ? soDigitos(v) : null;
    case 'cnpj':
      return cnpjValido(v) ? normalizarCnpj(v) : null;
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 77 ? v.toLowerCase() : null;
    case 'telefone': {
      const d = soDigitos(v);
      return /^[0-9]{10,13}$/.test(d) ? d : null;
    }
    case 'aleatoria':
      return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v) ? v.toLowerCase() : null;
  }
}
