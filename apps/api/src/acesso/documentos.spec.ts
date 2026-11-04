import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido, normalizarChavePix } from './documentos.js';

describe('documentos', () => {
  it('CPF: dígito verificador, máscara e repetições', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('1234')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });

  it('CNPJ numérico e alfanumérico (exemplo oficial)', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('12ABC34501DE35')).toBe(true);
    expect(cnpjValido('12abc34501de35')).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });

  it('chave PIX: valida pelo tipo e normaliza', () => {
    expect(normalizarChavePix('cpf', '529.982.247-25')).toBe('52998224725');
    expect(normalizarChavePix('cpf', '52998224726')).toBeNull();
    expect(normalizarChavePix('cnpj', '11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizarChavePix('email', ' Financeiro@Empresa.TEST ')).toBe('financeiro@empresa.test');
    expect(normalizarChavePix('email', 'sem-arroba')).toBeNull();
    expect(normalizarChavePix('telefone', '+55 (11) 99999-0000')).toBe('5511999990000');
    expect(normalizarChavePix('telefone', '123')).toBeNull();
    expect(normalizarChavePix('aleatoria', '123E4567-E89B-12D3-A456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(normalizarChavePix('aleatoria', 'nao-e-uuid')).toBeNull();
  });
});
