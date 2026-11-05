import { describe, expect, it } from 'vitest';
import { compararVersoes } from './diff.js';

const base = () => ({
  campos: { objeto: 'Compra de mesas', situacao: 'Divulgada', data_encerramento_propostas: '2026-11-18T13:00:00Z', valor_estimado: '1000.0000', srp: false },
  itens: [
    { numero_item: 1, descricao: 'Mesa', quantidade: '10.0000', unidade_medida: 'UNIDADE', valor_unitario_estimado: '100.0000' },
    { numero_item: 2, descricao: 'Cadeira', quantidade: '20.0000', unidade_medida: 'UNIDADE', valor_unitario_estimado: '50.0000' },
  ],
  arquivos: [{ url: 'https://x/1', tipo: 'edital', titulo: 'Edital' }],
});

describe('comparação de versões do edital', () => {
  it('sem mudança: nada a mostrar e sem aviso de proposta', () => {
    const d = compararVersoes(1, 2, base(), base());
    expect(d.campos).toEqual([]); expect(d.itens).toEqual([]); expect(d.arquivos).toEqual([]); expect(d.alteraProposta).toBe(false);
  });
  it('mudança de data não altera a proposta; mostra antes e depois', () => {
    const b = base(); b.campos.data_encerramento_propostas = '2026-11-25T13:00:00Z';
    const d = compararVersoes(1, 2, base(), b);
    expect(d.campos).toEqual([{ campo: 'data_encerramento_propostas', rotulo: 'Fim das propostas', formato: 'data', antes: '2026-11-18T13:00:00.000Z', depois: '2026-11-25T13:00:00.000Z' }]);
    expect(d.alteraProposta).toBe(false);
  });
  it('mesma data em formatos diferentes não é mudança; data diferente volta em ISO', () => {
    const a = base(); a.campos.data_encerramento_propostas = '2026-11-18 10:00:00-03:00';
    const b = base(); b.campos.data_encerramento_propostas = '2026-11-18T13:00:00Z';
    expect(compararVersoes(1, 2, a, b).campos).toEqual([]);
    b.campos.data_encerramento_propostas = '2026-11-18T14:00:00Z';
    expect(compararVersoes(1, 2, a, b).campos[0]).toMatchObject({ antes: '2026-11-18T13:00:00.000Z', depois: '2026-11-18T14:00:00.000Z' });
  });
  it('quantidade, item novo e item removido alteram a proposta', () => {
    const b = base(); Object.assign(b.itens[0] ?? {}, { quantidade: '12.0000' }); b.itens.push({ numero_item: 3, descricao: 'Armário', quantidade: '1.0000', unidade_medida: 'UNIDADE', valor_unitario_estimado: '300.0000' }); b.itens.splice(1, 1);
    const d = compararVersoes(1, 2, base(), b);
    expect(d.itens.map((i) => [i.numeroItem, i.tipo])).toEqual([[1, 'alterado'], [3, 'adicionado'], [2, 'removido']]);
    expect(d.itens[0]?.mudancas[0]).toMatchObject({ campo: 'quantidade', antes: '10.0000', depois: '12.0000' });
    expect(d.alteraProposta).toBe(true);
  });
  it('só o preço estimado de um item mudou: não altera a proposta', () => {
    const b = base(); Object.assign(b.itens[0] ?? {}, { valor_unitario_estimado: '90.0000' });
    const d = compararVersoes(1, 2, base(), b);
    expect(d.itens).toHaveLength(1); expect(d.alteraProposta).toBe(false);
  });
  it('objeto alterado dispara o aviso; arquivo novo e removido aparecem', () => {
    const b = base(); b.campos.objeto = 'Compra de mesas e cadeiras'; b.arquivos = [{ url: 'https://x/2', tipo: 'anexo', titulo: 'Retificação' }];
    const d = compararVersoes(1, 2, base(), b);
    expect(d.alteraProposta).toBe(true);
    expect(d.arquivos.map((a) => [a.url, a.situacao])).toEqual([['https://x/2', 'novo'], ['https://x/1', 'removido']]);
  });
  it('trunca texto muito longo', () => {
    const b = base(); b.campos.objeto = 'x'.repeat(5000);
    expect(compararVersoes(1, 2, base(), b).campos[0]?.depois?.length).toBe(2001);
  });
});
