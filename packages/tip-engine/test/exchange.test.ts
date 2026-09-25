import { describe, expect, it } from 'vitest';
import { convertUsdToArs, parseRate } from '../src';
import { expectCode } from './helpers';

describe('parseRate', () => {
  it('scales the rate by 10^6', () => {
    expect(parseRate('1180.50')).toBe(1_180_500_000n);
    expect(parseRate('1180.123456')).toBe(1_180_123_456n);
    expect(parseRate('1')).toBe(1_000_000n);
  });

  it.each(['0', '0.000000', '-5', 'abc', '', '1180.1234567'])('rejects "%s"', (rate) => {
    expectCode(() => parseRate(rate), 'INVALID_RATE');
  });

  it('rejects non-string rates', () => {
    expectCode(() => parseRate(1180.5 as unknown as string), 'INVALID_RATE');
  });
});

describe('convertUsdToArs', () => {
  it('USD 50.00 x 1180.00 = ARS 59.000,00', () => {
    // 50 x 1180 = 59000 pesos = 5_900_000 cents
    expect(convertUsdToArs(5000n, '1180.00')).toBe(5_900_000n);
  });

  it('rounds exactly .5 of a cent up', () => {
    // 0.01 USD x 1180.50 = 11.805 ARS = 1180.5 cents -> 1181
    expect(convertUsdToArs(1n, '1180.50')).toBe(1181n);
  });

  it('rounds just below .5 down', () => {
    // 0.01 USD x 1180.49 = 1180.49 cents -> 1180
    expect(convertUsdToArs(1n, '1180.49')).toBe(1180n);
  });

  it('keeps six decimals of the rate', () => {
    // 3 x 1180.123456 = 3540.370368 cents -> 3540
    expect(convertUsdToArs(3n, '1180.123456')).toBe(3540n);
  });

  it('converts zero to zero', () => {
    expect(convertUsdToArs(0n, '1180.00')).toBe(0n);
  });

  it('is exact for very large amounts', () => {
    // 10^12 cents x 1180.123456 = 1180123456 x 10^6 cents, exactly
    expect(convertUsdToArs(10n ** 12n, '1180.123456')).toBe(1_180_123_456_000_000n);
  });

  it('rejects invalid amounts and rates', () => {
    expectCode(() => convertUsdToArs(-1n, '1180.00'), 'INVALID_AMOUNT');
    expectCode(() => convertUsdToArs(50 as unknown as bigint, '1180.00'), 'INVALID_AMOUNT');
    expectCode(() => convertUsdToArs(5000n, '0'), 'INVALID_RATE');
    expectCode(() => convertUsdToArs(5000n, '-1'), 'INVALID_RATE');
  });
});
