import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, formatCents, formatCentsEsAr, parseCents } from '../src';
import { expectCode } from './helpers';

describe('divRoundHalfUp', () => {
  it.each([
    [5n, 2n, 3n], // 2.5 -> 3 (half rounds up)
    [4n, 2n, 2n], // exact
    [7n, 3n, 2n], // 2.33 -> 2
    [8n, 3n, 3n], // 2.67 -> 3
    [1n, 2n, 1n], // 0.5 -> 1
    [1n, 3n, 0n], // 0.33 -> 0
    [0n, 5n, 0n],
    [15n, 10n, 2n], // 1.5 -> 2
    [14n, 10n, 1n], // 1.4 -> 1
  ])('%s / %s = %s', (n, d, expected) => {
    expect(divRoundHalfUp(n, d)).toBe(expected);
  });

  it('is exact for values beyond Number.MAX_SAFE_INTEGER', () => {
    // (10^20 + 1) / 2 = 50000000000000000000.5 -> rounds up
    expect(divRoundHalfUp(10n ** 20n + 1n, 2n)).toBe(5n * 10n ** 19n + 1n);
  });

  it('rejects invalid operands', () => {
    expectCode(() => divRoundHalfUp(1n, 0n), 'INVALID_AMOUNT');
    expectCode(() => divRoundHalfUp(1n, -2n), 'INVALID_AMOUNT');
    expectCode(() => divRoundHalfUp(-1n, 2n), 'INVALID_AMOUNT');
    expectCode(() => divRoundHalfUp(1 as unknown as bigint, 2n), 'INVALID_AMOUNT');
  });
});

describe('cents parsing and formatting', () => {
  it('parses and formats plain decimals', () => {
    expect(parseCents('1234.56')).toBe(123456n);
    expect(parseCents('347990')).toBe(34799000n);
    expect(formatCents(123456n)).toBe('1234.56');
  });

  it('rejects more than two decimals on money', () => {
    expectCode(() => parseCents('10.005'), 'INVALID_DECIMAL');
  });

  it.each([
    [34799000n, '347.990,00'],
    [5n, '0,05'],
    [0n, '0,00'],
    [99999n, '999,99'],
    [100000n, '1.000,00'],
    [100000000n, '1.000.000,00'],
    [-150n, '-1,50'],
  ])('formats %s as es-AR "%s"', (cents, expected) => {
    expect(formatCentsEsAr(cents)).toBe(expected);
  });

  it('rejects non-bigint amounts when formatting', () => {
    expectCode(() => formatCentsEsAr(1.5 as unknown as bigint), 'INVALID_AMOUNT');
  });
});
