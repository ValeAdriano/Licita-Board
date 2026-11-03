import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContadorFalhas, captchaValido, senhaVazada } from './protecoes.js';

const resposta = (texto: string, ok = true) => Promise.resolve({ ok, text: () => Promise.resolve(texto) });

describe('senhaVazada', () => {
  it('manda só o prefixo de 5 caracteres e acha o sufixo na resposta', async () => {
    const sha1 = createHash('sha1').update('uma-senha-longa-qualquer').digest('hex').toUpperCase();
    let pedida = '';
    const vazou = await senhaVazada('uma-senha-longa-qualquer', 'https://hibp.teste/range/', (url) => {
      pedida = url;
      return resposta(`0000000000000000000000000000000000A:0\n${sha1.slice(5)}:42\n`);
    });
    expect(pedida).toBe(`https://hibp.teste/range/${sha1.slice(0, 5)}`);
    expect(pedida).not.toContain(sha1.slice(5));
    expect(vazou).toBe(true);
  });

  it('linha de padding (contagem 0) não conta e HIBP fora do ar não bloqueia', async () => {
    const sha1 = createHash('sha1').update('outra-senha-longa-x').digest('hex').toUpperCase();
    expect(await senhaVazada('outra-senha-longa-x', 'https://h/', () => resposta(`${sha1.slice(5)}:0`))).toBe(false);
    let avisos = 0;
    expect(await senhaVazada('outra-senha-longa-x', 'https://h/', () => Promise.reject(new Error('rede')), () => {
      avisos++;
    })).toBe(false);
    expect(avisos).toBe(1);
  });

  it('lista local pega senhas óbvias mesmo sem HIBP', async () => {
    expect(await senhaVazada('123456789012', '')).toBe(true);
    expect(await senhaVazada('aaaaaaaaaaaa', '')).toBe(true);
    expect(await senhaVazada('cavalo-bateria-grampo', '')).toBe(false);
  });
});

describe('captcha e contador', () => {
  it('Turnstile: sem resposta é inválido; success=true é válido', async () => {
    expect(await captchaValido('s', undefined, null)).toBe(false);
    expect(await captchaValido('s', 'tok', '203.0.113.1', () => resposta('{"success":true}'))).toBe(true);
    expect(await captchaValido('s', 'tok', null, () => resposta('{"success":false}'))).toBe(false);
  });

  it('conta falhas em 15 min e limpa no sucesso', () => {
    const c = new ContadorFalhas();
    c.registrar('a', 0);
    c.registrar('a', 1000);
    expect(c.quantas('a', 2000)).toBe(2);
    expect(c.quantas('a', 16 * 60_000)).toBe(0);
    c.limpar('a');
    expect(c.quantas('a', 2000)).toBe(0);
  });
});
