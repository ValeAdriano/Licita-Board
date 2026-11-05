import { describe, expect, it } from 'vitest';
import { alertas, dias, type Base } from './alertas.js';

const base = (o: Partial<Base> = {}): Base => ({ hoje: '2026-11-05', vigenciaFim: '2027-12-31', garantiaAte: null, status: 'ativo', empenhos: [], faturas: [], ...o });

describe('alertas do contrato', () => {
  it('conta dias de calendário', () => {
    expect(dias('2026-11-05', '2026-11-06')).toBe(1);
    expect(dias('2026-11-05', '2026-11-04')).toBe(-1);
    expect(dias('2026-02-28', '2026-03-01')).toBe(1);
  });
  it('sem pendência não alerta; contrato encerrado nunca alerta', () => {
    expect(alertas(base())).toEqual([]);
    expect(alertas(base({ status: 'encerrado', vigenciaFim: '2020-01-01' }))).toEqual([]);
  });
  it('vigência: próxima (60 dias) e vencida', () => {
    expect(alertas(base({ vigenciaFim: '2027-01-04' })).map((a) => [a.tipo, a.nivel, a.dias])).toEqual([['vigencia', 'proximo', 60]]);
    expect(alertas(base({ vigenciaFim: '2027-01-05' }))).toEqual([]); // 61 dias
    expect(alertas(base({ vigenciaFim: '2026-11-01' })).map((a) => [a.nivel, a.dias])).toEqual([['vencido', -4]]);
  });
  it('garantia, entrega e pagamento', () => {
    const r = alertas(base({
      garantiaAte: '2026-12-01',
      empenhos: [{ numero: 'E1', prazoEntrega: '2026-11-03', etapa: 'transporte' }, { numero: 'E2', prazoEntrega: '2026-11-08', etapa: 'entrega' }, { numero: 'E3', prazoEntrega: '2026-10-01', etapa: 'concluido' }, { numero: 'E4', prazoEntrega: null, etapa: 'entrega' }],
      faturas: [{ numeroNf: '10', vencimento: '2026-10-30', pagoEm: null }, { numeroNf: '11', vencimento: '2026-10-30', pagoEm: '2026-11-01' }, { numeroNf: '12', vencimento: '2026-11-30', pagoEm: null }],
    }));
    expect(r.map((a) => `${a.tipo}:${a.nivel}`)).toEqual(['garantia:proximo', 'entrega:vencido', 'entrega:proximo', 'pagamento:vencido']);
    expect(r.find((a) => a.tipo === 'pagamento')?.dias).toBe(-6);
  });
  it('sem acesso ao financeiro (faturas nulas) não inventa alerta de pagamento', () => {
    expect(alertas(base({ faturas: null }))).toEqual([]);
  });
});
