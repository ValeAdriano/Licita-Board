import { describe, expect, it } from 'vitest';
import { LimitePorIp, chaveDeIp } from './auth.service.js';

describe('LimitePorIp', () => {
  it('permite 20 por minuto por IP e recusa o 21º', () => {
    const l = new LimitePorIp();
    for (let i = 0; i < 20; i++) expect(l.permitir('203.0.113.1', 1000)).toBe(true);
    expect(l.permitir('203.0.113.1', 1000)).toBe(false);
    expect(l.permitir('203.0.113.2', 1000)).toBe(true);
    expect(l.permitir('203.0.113.1', 62_000)).toBe(true);
  });

  it('agrupa IPv6 por /64', () => {
    expect(chaveDeIp('2001:db8:1:2:aaaa::1')).toBe(chaveDeIp('2001:db8:1:2:bbbb::9'));
    expect(chaveDeIp('2001:db8:1:2::1')).not.toBe(chaveDeIp('2001:db8:1:3::1'));
  });
});
