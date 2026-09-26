import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyShort, formatScaled, parseDecimal, parseMoney } from './decimal';

describe('parseDecimal', () => {
  it('acepta coma o punto decimal', () => {
    expect(parseDecimal('0,014', 4)).toBe(140n);
    expect(parseDecimal('0.014', 4)).toBe(140n);
    expect(parseDecimal('45', 2)).toBe(4500n);
    expect(parseDecimal('7,5', 2)).toBe(750n);
  });

  it('rechaza texto, negativos y decimales de más', () => {
    expect(parseDecimal('abc', 2)).toBeNull();
    expect(parseDecimal('-1', 2)).toBeNull();
    expect(parseDecimal('1,234', 2)).toBeNull();
    expect(parseDecimal('1,230', 2)).toBe(123n);
  });
});

describe('parseMoney', () => {
  it('interpreta el formato argentino', () => {
    expect(parseMoney('347.990')).toBe(34_799_000n);
    expect(parseMoney('347990')).toBe(34_799_000n);
    expect(parseMoney('$ 10.000')).toBe(1_000_000n);
    expect(parseMoney('1.234,5')).toBe(123_450n);
    expect(parseMoney('0.5')).toBe(50n);
  });

  it('rechaza vacíos y texto', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('diez')).toBeNull();
  });
});

describe('formato', () => {
  it('usa separadores es-AR y redondea half-up', () => {
    expect(formatMoney(4_143_581n)).toBe('$ 41.435,81');
    expect(formatMoneyShort(4_143_581n)).toBe('$ 41.436');
    expect(formatMoneyShort(34_799_000n)).toBe('$ 347.990');
    expect(formatScaled(630_000n, 6, 3)).toBe('0,630');
    expect(formatScaled(1167n, 2, 2)).toBe('11,67');
    expect(formatMoney(-150n)).toBe('-$ 1,50');
  });
});
