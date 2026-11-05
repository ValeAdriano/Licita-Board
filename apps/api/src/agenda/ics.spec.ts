import { describe, expect, it } from 'vitest';
import { dobrar, escaparTexto, gerarIcs, type EventoIcs } from './ics.js';

const ev = (o: Partial<EventoIcs> = {}): EventoIcs => ({
  id: 'a1', tipo: 'impugnacao', status: 'sugerido', dataLimite: '2026-11-13T02:59:00Z', provisorio: false, regraValidada: false, aviso: null,
  responsavel: 'Ana', numeroEdital: '12/2026', objeto: 'Compra de, itens; vários', orgao: 'Prefeitura X', ...o,
});
const AGORA = new Date('2026-11-05T12:00:00Z');

describe('iCalendar da agenda', () => {
  it('gera VEVENT em UTC com UID estável, CRLF e alarme de 1 dia', () => {
    const t = gerarIcs([ev()], AGORA);
    expect(t.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(t.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(t).toContain('UID:a1@vv-licitacoes');
    expect(t).toContain('DTSTART:20261113T025900Z');
    expect(t).toContain('DTSTAMP:20261105T120000Z');
    expect(t).toContain('SUMMARY:Impugnação · Prefeitura X');
    expect(t).toContain('TRIGGER:-P1D');
    expect(t).toContain('STATUS:CONFIRMED');
    expect(t.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('marca provisório como TENTATIVE e avisa que a regra não foi validada', () => {
    const t = gerarIcs([ev({ provisorio: true })], AGORA).replace(/\r\n /g, '');
    expect(t).toContain('STATUS:TENTATIVE');
    expect(t).toContain('PRAZO PROVISÓRIO');
    expect(t).toContain('NÃO validada pelo jurídico');
  });
  it('pula evento sem data e não põe alarme em prazo já encerrado', () => {
    const t = gerarIcs([ev({ id: 'x', dataLimite: null }), ev({ id: 'p', status: 'protocolado' })], AGORA);
    expect(t).not.toContain('UID:x@');
    expect(t).toContain('UID:p@');
    expect(t).not.toContain('VALARM');
  });
  it('escapa vírgula, ponto e vírgula, barra e quebra de linha (sem injeção de campos)', () => {
    expect(escaparTexto('a,b;c\\d\ne')).toBe('a\\,b\;c\\\\d\\ne');
    const t = gerarIcs([ev({ objeto: 'x\r\nATTENDEE:mailto:a@b.c' })], AGORA).replace(/\r\n /g, '');
    expect(t).not.toMatch(/\r\nATTENDEE:/);
  });
  it('dobra linhas em 75 octetos sem cortar caractere UTF-8', () => {
    const longa = `DESCRIPTION:${'ã'.repeat(100)}`;
    const partes = dobrar(longa).split('\r\n');
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(partes.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(longa);
  });
});
