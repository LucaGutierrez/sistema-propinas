import { describe, expect, it } from 'vitest';
import { parseDecimal } from '@/lib/decimal';
import { FACTOR_SCALE } from '@/lib/distribution/provisional-formula';
import { formatPortion, parsePortionInput, portionInputError } from './portion-format';

describe('porción: decimal o porcentaje (solo presentación)', () => {
  it('muestra la misma porción en los dos formatos', () => {
    expect(formatPortion('0,022', 'DECIMAL')).toBe('0,022');
    expect(formatPortion('0,022', 'PERCENT')).toBe('2,2 %');
    expect(formatPortion('0,007', 'PERCENT')).toBe('0,7 %');
    expect(formatPortion('0,014', 'PERCENT')).toBe('1,4 %');
    expect(formatPortion('0,0145', 'PERCENT')).toBe('1,45 %');
    expect(formatPortion('1', 'PERCENT')).toBe('100 %');
    expect(formatPortion('10', 'DECIMAL')).toBe('10');
  });

  it('acepta el valor tal como viene de la base (ceros de más)', () => {
    expect(formatPortion('0.0220000000', 'DECIMAL')).toBe('0,022');
    expect(formatPortion('0.0220000000', 'PERCENT')).toBe('2,2 %');
  });

  it('lo escrito en porcentaje se guarda como la misma fracción decimal', () => {
    expect(parsePortionInput('2,2', 'PERCENT')).toBe('0,022');
    expect(parsePortionInput('2,2 %', 'PERCENT')).toBe('0,022');
    expect(parsePortionInput('0,7%', 'PERCENT')).toBe('0,007');
    expect(parsePortionInput('1.45', 'PERCENT')).toBe('0,0145');
    expect(parsePortionInput('0,022', 'DECIMAL')).toBe('0,022');
  });

  it('ida y vuelta: el número guardado nunca cambia por el formato', () => {
    for (const factor of ['0,022', '0,007', '0,014', '0,0145', '0,25', '1', '2,5']) {
      const e4 = parseDecimal(factor, FACTOR_SCALE);
      for (const display of ['DECIMAL', 'PERCENT'] as const) {
        const shown = formatPortion(factor, display).replace(/ %$/, '');
        const saved = parsePortionInput(shown, display);
        expect(saved === null ? null : parseDecimal(saved, FACTOR_SCALE)).toBe(e4);
      }
    }
  });

  it('rechaza cero, negativos, texto y más decimales de los que se guardan', () => {
    for (const display of ['DECIMAL', 'PERCENT'] as const) {
      expect(parsePortionInput('0', display)).toBeNull();
      expect(parsePortionInput('-1', display)).toBeNull();
      expect(parsePortionInput('abc', display)).toBeNull();
      expect(parsePortionInput('', display)).toBeNull();
    }
    // 4 decimales en la fracción = 2 en el porcentaje.
    expect(parsePortionInput('0,02255', 'DECIMAL')).toBeNull();
    expect(parsePortionInput('2,255', 'PERCENT')).toBeNull();
    expect(portionInputError('PERCENT')).toMatch(/hasta 2 decimales/);
    expect(portionInputError('DECIMAL')).toMatch(/hasta 4 decimales/);
  });
});
