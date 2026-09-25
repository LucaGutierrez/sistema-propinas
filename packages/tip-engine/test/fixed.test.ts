import { describe, expect, it } from 'vitest';
import { formatFixed, parseFixed } from '../src';
import { pow10 } from '../src/fixed';
import { expectCode } from './helpers';

describe('parseFixed', () => {
  it.each([
    ['7.5', 2, 750n],
    ['7', 2, 700n],
    ['0', 2, 0n],
    ['0.25', 2, 25n],
    ['007.50', 2, 750n],
    ['7.500', 2, 750n], // extra trailing zeros are harmless
    ['1180.123456', 6, 1180123456n],
    ['0.000001', 6, 1n],
    ['12', 0, 12n],
  ])('parses "%s" at scale %i as %s', (input, scale, expected) => {
    expect(parseFixed(input, scale)).toBe(expected);
  });

  it('is exact beyond Number.MAX_SAFE_INTEGER (9007199254740991)', () => {
    expect(parseFixed('90071992547409.93', 2)).toBe(9007199254740993n);
  });

  it.each(['7.505', '0.001', '1.0000001'])(
    'rejects "%s": non-zero digits beyond the scale',
    (input) => {
      expectCode(() => parseFixed(input, input === '1.0000001' ? 6 : 2), 'INVALID_DECIMAL');
    },
  );

  it.each([
    '',
    'abc',
    '-1',
    '+1',
    '1e3',
    '.5',
    '5.',
    '1,5',
    ' 1',
    '1 ',
    '1..2',
    'Infinity',
    'NaN',
    '0x10',
    '1_000',
  ])('rejects malformed input "%s"', (input) => {
    expectCode(() => parseFixed(input, 2), 'INVALID_DECIMAL');
  });

  it('rejects non-string input (floats must never sneak in)', () => {
    expectCode(() => parseFixed(7.5 as unknown as string, 2), 'INVALID_DECIMAL');
    expectCode(() => parseFixed(null as unknown as string, 2), 'INVALID_DECIMAL');
    expectCode(() => parseFixed(750n as unknown as string, 2), 'INVALID_DECIMAL');
  });

  it('rejects absurdly long input', () => {
    expectCode(() => parseFixed('1'.repeat(41), 2), 'INVALID_DECIMAL');
  });
});

describe('formatFixed', () => {
  it.each([
    [750n, 2, '7.50'],
    [5n, 2, '0.05'],
    [0n, 2, '0.00'],
    [123456n, 2, '1234.56'],
    [1n, 6, '0.000001'],
    [7n, 0, '7'],
    [-150n, 2, '-1.50'],
  ])('formats %s at scale %i as "%s"', (value, scale, expected) => {
    expect(formatFixed(value, scale)).toBe(expected);
  });

  it('round-trips with parseFixed', () => {
    for (const text of ['0.00', '0.01', '7.50', '24.00', '1180.50', '99999999999.99']) {
      expect(formatFixed(parseFixed(text, 2), 2)).toBe(text);
    }
  });

  it('rejects non-bigint values', () => {
    expectCode(() => formatFixed(7 as unknown as bigint, 2), 'INVALID_DECIMAL');
  });
});

describe('pow10', () => {
  it('computes powers of ten as bigint', () => {
    expect(pow10(0)).toBe(1n);
    expect(pow10(2)).toBe(100n);
    expect(pow10(6)).toBe(1_000_000n);
  });

  it('rejects invalid scales', () => {
    expectCode(() => pow10(-1), 'INVALID_DECIMAL');
    expectCode(() => pow10(1.5), 'INVALID_DECIMAL');
    expectCode(() => pow10(31), 'INVALID_DECIMAL');
  });
});
