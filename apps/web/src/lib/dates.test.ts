import { describe, expect, it } from 'vitest';
import { periodStartOf, todayInTimeZone } from './dates';

describe('periodStartOf', () => {
  it('ajusta al día de inicio del período (ISO: 1 = lunes … 7 = domingo)', () => {
    // 2026-09-28 es lunes.
    expect(periodStartOf('2026-09-28', 1)).toBe('2026-09-28');
    expect(periodStartOf('2026-10-04', 1)).toBe('2026-09-28');
    expect(periodStartOf('2026-10-05', 1)).toBe('2026-10-05');
    expect(periodStartOf('2026-09-30', 3)).toBe('2026-09-30');
    expect(periodStartOf('2026-09-29', 3)).toBe('2026-09-23');
    expect(periodStartOf('2026-10-03', 7)).toBe('2026-09-27');
  });

  it('rechaza días inválidos', () => {
    expect(() => periodStartOf('2026-09-28', 0)).toThrow();
    expect(() => periodStartOf('no', 1)).toThrow();
  });
});

describe('todayInTimeZone', () => {
  it('usa el calendario de la zona del restaurante', () => {
    const instant = new Date('2026-09-28T02:30:00Z');
    expect(todayInTimeZone('America/Argentina/Buenos_Aires', instant)).toBe('2026-09-27');
    expect(todayInTimeZone('UTC', instant)).toBe('2026-09-28');
  });
});
