import { describe, expect, it } from 'vitest';
import { gerarXlsx } from '../exportacao/xlsx.js';
import { CABECALHO, celula, gerarCsv, montarLinhas, type EventoCsv } from './csv.js';

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

describe('XLSX da agenda', () => {
  it('reutiliza exatamente as colunas e linhas do CSV; dados de edital seguem como texto', () => {
    const evento = ev({ dataLimite: '2026-11-10T15:00:00.000Z', origemPrazo: 'edital', aviso: '=2+2', responsavel: null, prioridade: 'urgente', numeroEdital: 'PE 1/2026', objeto: 'Objeto; de teste', orgao: 'Órgão', uf: 'SP', municipio: 'São Paulo' });
    const linha = montarLinhas([evento])[0] ?? [];
    expect(CABECALHO).toHaveLength(15);
    expect(linha).toHaveLength(CABECALHO.length);
    expect(linha).toEqual(['10/11/2026 12:00', '', 'Impugnação', 'Sugerido', 'Órgão', 'SP', 'São Paulo', 'PE 1/2026', 'Objeto; de teste', '', 'Urgente', 'Sim', 'Não', 'Edital', '=2+2']);
    expect(gerarCsv([evento])).toContain("'=2+2");
    const xlsx = gerarXlsx([{ nome: 'Agenda', colunas: CABECALHO.map((titulo) => ({ titulo })), linhas: montarLinhas([evento]) }]);
    expect(xlsx.readUInt32LE(0)).toBe(0x04034b50);
  });
});
