import { describe, expect, it } from 'vitest';
import {
  addDays,
  datesInRange,
  isValidIsoDate,
  isoWeekday,
  weekRange,
  type WeekdayNumber,
} from '../src';
import { expectCode } from './helpers';

describe('isValidIsoDate', () => {
  it.each(['2026-09-24', '2028-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])(
    'accepts %s',
    (date) => {
      expect(isValidIsoDate(date)).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2026-02-29', // 2026 is not a leap year
    '2100-02-29', // century, not a leap year
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-04-31',
    '2026-1-1',
    '26-01-01',
    '0000-01-01',
    '',
    'abc',
  ])('rejects %s', (date) => {
    expect(isValidIsoDate(date)).toBe(false);
  });
});

describe('isoWeekday', () => {
  it.each([
    ['2026-09-21', 1],
    ['2026-09-24', 4],
    ['2026-09-27', 7],
    ['1970-01-01', 4],
    ['1969-12-31', 3],
    ['2000-01-01', 6],
    ['2024-02-29', 4],
  ] as const)('%s is weekday %i', (date, expected) => {
    expect(isoWeekday(date)).toBe(expected);
  });
});

describe('addDays', () => {
  it.each([
    ['2026-12-31', 1n, '2027-01-01'],
    ['2028-02-28', 1n, '2028-02-29'],
    ['2027-02-28', 1n, '2027-03-01'],
    ['2026-03-01', -1n, '2026-02-28'],
    ['2026-09-24', 7n, '2026-10-01'],
    ['2026-09-24', 0n, '2026-09-24'],
    ['1970-01-01', -1n, '1969-12-31'],
  ])('%s + %s days = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it('rejects invalid dates', () => {
    expectCode(() => addDays('2026-02-30', 1n), 'INVALID_DATE');
  });
});

describe('weekRange', () => {
  it('Monday-based week for a Thursday', () => {
    expect(weekRange('2026-09-24', 1)).toEqual({ weekStart: '2026-09-21', weekEnd: '2026-09-27' });
  });

  it('a Monday is the start of its own week', () => {
    expect(weekRange('2026-09-21', 1)).toEqual({ weekStart: '2026-09-21', weekEnd: '2026-09-27' });
  });

  it('a Sunday is the last day of a Monday-based week', () => {
    expect(weekRange('2026-09-27', 1)).toEqual({ weekStart: '2026-09-21', weekEnd: '2026-09-27' });
  });

  it('Sunday-based week', () => {
    expect(weekRange('2026-09-24', 7)).toEqual({ weekStart: '2026-09-20', weekEnd: '2026-09-26' });
    expect(weekRange('2026-09-27', 7)).toEqual({ weekStart: '2026-09-27', weekEnd: '2026-10-03' });
  });

  it('Wednesday-based week', () => {
    expect(weekRange('2026-09-24', 3)).toEqual({ weekStart: '2026-09-23', weekEnd: '2026-09-29' });
  });

  it('crosses month boundaries', () => {
    expect(weekRange('2026-10-01', 1)).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
  });

  it('crosses year boundaries', () => {
    expect(weekRange('2026-01-01', 1)).toEqual({ weekStart: '2025-12-29', weekEnd: '2026-01-04' });
  });

  it('always spans exactly 7 days', () => {
    for (const startsOn of [1, 2, 3, 4, 5, 6, 7] as WeekdayNumber[]) {
      const { weekStart, weekEnd } = weekRange('2026-09-24', startsOn);
      expect(datesInRange(weekStart, weekEnd)).toHaveLength(7);
      expect(isoWeekday(weekStart)).toBe(startsOn);
    }
  });

  it('rejects an invalid week start day or date', () => {
    expectCode(() => weekRange('2026-09-24', 0 as WeekdayNumber), 'INVALID_DATE');
    expectCode(() => weekRange('2026-09-24', 8 as WeekdayNumber), 'INVALID_DATE');
    expectCode(() => weekRange('2026-02-30', 1), 'INVALID_DATE');
  });
});

describe('datesInRange', () => {
  it('lists every date inclusively', () => {
    expect(datesInRange('2026-09-21', '2026-09-27')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('returns a single date when start equals end and nothing when reversed', () => {
    expect(datesInRange('2026-09-21', '2026-09-21')).toEqual(['2026-09-21']);
    expect(datesInRange('2026-09-22', '2026-09-21')).toEqual([]);
  });
});
