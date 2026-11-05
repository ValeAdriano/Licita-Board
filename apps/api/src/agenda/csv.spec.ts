import { describe, expect, it } from 'vitest';
import { celula, gerarCsv, type EventoCsv } from './csv.js';

const ev = (o: Partial<EventoCsv> = {}): EventoCsv => ({
  tipo: 'impugnacao', status: 'sugerido', dataLimite: '2026-11-13T02:59:00Z', dataInterna: null, provisorio: true, regraValidada: false, origemPrazo: 'regra',
  aviso: null, responsavel: 'Ana', prioridade: 'alta', numeroEdital: '12/2026', objeto: 'Compra; de "itens"', orgao: 'Prefeitura X', uf: 'PR', municipio: 'Curitiba', ...o,
});

describe('CSV da agenda', () => {
  it('começa com BOM, usa ; e CRLF, e escreve o prazo em horário de Brasília', () => {
    const t = gerarCsv([ev()]);
    expect(t.startsWith('﻿Prazo (Brasília);')).toBe(true);
    const linha = t.split('\r\n')[1] ?? '';
    expect(linha.startsWith('12/11/2026 23:59;;Impugnação;Sugerido;Prefeitura X;PR;Curitiba;12/2026;')).toBe(true);
    expect(linha).toContain('"Compra; de ""itens"""');
    expect(linha).toContain(';Alta;Sim;Não;Regra;');
  });
  it('neutraliza fórmula do Excel vinda de texto de edital', () => {
    expect(celula('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(celula('+55')).toBe("'+55");
    expect(celula('@SOMA(A1)')).toBe("'@SOMA(A1)");
    expect(celula('texto normal')).toBe('texto normal');
  });
});
