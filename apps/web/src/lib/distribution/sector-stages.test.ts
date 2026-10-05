import { describe, expect, it } from 'vitest';
import { formatStagePercent, parseStagePercent, unassignedCents } from './sector-stages';

describe('porcentajes de sector', () => {
  it('acepta números > 0 y ≤ 100 con hasta 2 decimales', () => {
    expect(parseStagePercent('30')).toBe(3000n);
    expect(parseStagePercent('12,5')).toBe(1250n);
    expect(parseStagePercent('33.33 %')).toBe(3333n);
    expect(parseStagePercent('100')).toBe(10000n);
    for (const bad of ['0', '100,01', '-5', 'abc', '', '1,234', null]) {
      expect({ bad, value: parseStagePercent(bad) }).toEqual({ bad, value: null });
    }
    expect(formatStagePercent(1250n)).toBe('12,5');
    expect(formatStagePercent(10000n)).toBe('100');
  });
});

describe('repartos viejos por etapas', () => {
  it('lo sin asignar es el saldo de la última etapa', () => {
    expect(unassignedCents([{ remainderCents: '7000000' }, { remainderCents: '350000' }])).toBe(
      350_000n,
    );
    expect(unassignedCents([])).toBe(0n);
  });
});
