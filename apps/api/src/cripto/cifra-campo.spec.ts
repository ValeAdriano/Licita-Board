import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CifraCampo, mascarar } from './cifra-campo.js';

// Vetores compartilhados com o worker (Python confere os mesmos em apps/worker/tests).
const V = JSON.parse(readFileSync(new URL('../../../../docs/referencia/cifra-campo-vetores.json', import.meta.url), 'utf8')) as {
  segredo: string; contexto: string; texto: string; dek_hex: string; iv_hex: string; iv_dek_hex: string;
  envelope: { v: number; dek: string; iv: string; ct: string };
  hmac: { dominio: string; valor: string; marca: string };
};
const cifra = () => new CifraCampo(V.segredo);

describe('cifra de campo em envelope', () => {
  it('vetor fixo: com a mesma aleatoriedade, gera exatamente o envelope do vetor', () => {
    const env = cifra().cifrar(V.texto, V.contexto, {
      dek: Buffer.from(V.dek_hex, 'hex'), iv: Buffer.from(V.iv_hex, 'hex'), ivDek: Buffer.from(V.iv_dek_hex, 'hex'),
    });
    expect(env).toEqual(V.envelope);
  });

  it('decifra o envelope do vetor e dá a volta (ida e volta com acentos e emoji)', () => {
    expect(cifra().decifrar(V.envelope, V.contexto)).toBe(V.texto);
    for (const t of ['', '123.456.789-09', 'Ação ç 日本 🚀', 'x'.repeat(5000)]) {
      expect(cifra().decifrar(cifra().cifrar(t, V.contexto), V.contexto)).toBe(t);
    }
  });

  it('cada cifragem é diferente (DEK e IV novos) e o valor não aparece no envelope', () => {
    const a = cifra().cifrar(V.texto, V.contexto);
    const b = cifra().cifrar(V.texto, V.contexto);
    expect(a.ct).not.toBe(b.ct);
    expect(a.dek).not.toBe(b.dek);
    expect(JSON.stringify(a)).not.toContain(V.texto);
    expect(Buffer.from(a.ct, 'base64').toString('latin1')).not.toContain('chave-pix');
  });

  it('o contexto (tabela, coluna, empresa) faz parte do dado: envelope copiado para outra linha não abre', () => {
    const env = cifra().cifrar(V.texto, V.contexto);
    expect(() => cifra().decifrar(env, V.contexto.replace('0001', '0002'))).toThrow('Falha ao decifrar.');
    expect(() => cifra().decifrar(env, 'core.empresa_contas.agencia:00000000-0000-7000-8000-000000000001')).toThrow('Falha ao decifrar.');
  });

  it('adulteração, outra KEK, versão desconhecida e lixo dão o mesmo erro genérico', () => {
    const env = cifra().cifrar(V.texto, V.contexto);
    const ct = Buffer.from(env.ct, 'base64');
    ct[0] = (ct[0] ?? 0) ^ 1;
    const dek = Buffer.from(env.dek, 'base64');
    dek[20] = (dek[20] ?? 0) ^ 1;
    const ruins: unknown[] = [
      { ...env, ct: ct.toString('base64') }, { ...env, dek: dek.toString('base64') }, { ...env, v: 2 }, { ...env, iv: 'AAAA' },
      { ...env, dek: 'curto' }, null, 'texto', {}, { v: 1 },
    ];
    for (const r of ruins) expect(() => cifra().decifrar(r, V.contexto)).toThrow('Falha ao decifrar.');
    expect(() => new CifraCampo('outra-kek-de-teste-nao-usar-em-producao-9876543210').decifrar(env, V.contexto)).toThrow('Falha ao decifrar.');
  });

  it('exige KEK de pelo menos 32 caracteres', () => {
    expect(() => new CifraCampo('curta')).toThrow(/32/);
  });

  it('marca HMAC: determinística, confere com o vetor, separada por domínio e por KEK', () => {
    const c = cifra();
    expect(c.marca(V.hmac.valor, V.hmac.dominio)).toBe(V.hmac.marca);
    expect(c.marca('12345678909', 'cpf:e1')).toBe(c.marca('12345678909', 'cpf:e1'));
    expect(c.marca('12345678909', 'cpf:e1')).not.toBe(c.marca('12345678909', 'cpf:e2'));
    expect(c.marca('12345678909', 'cpf:e1')).not.toBe(c.marca('12345678909', 'pix:e1'));
    expect(new CifraCampo('outra-kek-de-teste-nao-usar-em-producao-9876543210').marca('12345678909', 'cpf:e1')).not.toBe(c.marca('12345678909', 'cpf:e1'));
    expect(c.marca('x', 'd')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('máscara mostra só o final e nunca o valor inteiro', () => {
    expect(mascarar('12345678909')).toBe('•••••••8909');
    expect(mascarar('chave-pix-aleatoria-0123456789abcdef')).toBe('••••••••cdef');
    expect(mascarar('123')).toBe('••••');
    expect(mascarar('1234')).toBe('••••');
    expect(mascarar('12345')).toBe('•2345');
  });
});
