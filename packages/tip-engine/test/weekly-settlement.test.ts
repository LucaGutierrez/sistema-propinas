import { describe, expect, it } from 'vitest';
import {
  computeDailyDistribution,
  computeWeeklySettlement,
  type DailyDistributionResult,
  type PendingAdvance,
  type SettledDay,
  type SettledItem,
} from '../src';
import { ars, expectCode, nextPending, permute, row } from './helpers';

const WEEK = '2026-09-21'; // Monday; the week ends on Sunday 2026-09-27

const si = (employeeId: string, grossCents: bigint, advancesCents = 0n): SettledItem => ({
  employeeId,
  grossCents,
  advancesCents,
  finalCents: grossCents - advancesCents,
});

const day = (date: string, distributionId: string, items: SettledItem[]): SettledDay => ({
  date,
  distributionId,
  items,
});

// A hand-built week (all amounts in cents):
//   Mon 21  d1: A 100_000/0        B  50_000/20_000
//   Tue 22  d2: A 120_000/0        B  60_000/60_000   (advance absorbs the whole day)
//   Wed 23  (no distribution)
//   Thu 24  d3: A  90_000/0        C  30_000/0
//   Fri 25  (no distribution)
//   Sat 26  d4: A 110_000/0        B  40_000/10_000
//   Sun 27  (no distribution)
const sampleWeek = (): SettledDay[] => [
  day('2026-09-21', 'd1', [si('A', 100_000n), si('B', 50_000n, 20_000n)]),
  day('2026-09-22', 'd2', [si('A', 120_000n), si('B', 60_000n, 60_000n)]),
  day('2026-09-24', 'd3', [si('A', 90_000n), si('C', 30_000n)]),
  day('2026-09-26', 'd4', [si('A', 110_000n), si('B', 40_000n, 10_000n)]),
];

describe('weekly settlement: accumulation of daily distributions', () => {
  const result = computeWeeklySettlement({ weekStart: WEEK, days: sampleWeek() });

  it('spans the 7 days of the week', () => {
    expect(result.weekStart).toBe('2026-09-21');
    expect(result.weekEnd).toBe('2026-09-27');
    expect(result.distributionCount).toBe(4);
  });

  it('generates one envelope per employee with the weekly total', () => {
    // A: 100_000 + 120_000 + 90_000 + 110_000 = 420_000, no advances
    // B: 50_000 + 60_000 + 40_000 = 150_000 ; advances 20_000 + 60_000 + 10_000 = 90_000 ; net 60_000
    // C: 30_000
    expect(
      result.payments.map((p) => [p.employeeId, p.grossCents, p.advancesCents, p.netCents]),
    ).toEqual([
      ['A', 420_000n, 0n, 420_000n],
      ['B', 150_000n, 90_000n, 60_000n],
      ['C', 30_000n, 0n, 30_000n],
    ]);
  });

  it('totals of the week', () => {
    // gross 420_000 + 150_000 + 30_000 = 600_000 ; advances 90_000 ; net 510_000
    expect(result.totals).toEqual({
      grossCents: 600_000n,
      advancesCents: 90_000n,
      netCents: 510_000n,
    });
  });

  it('keeps the day-by-day breakdown of each envelope', () => {
    const b = result.payments.find((p) => p.employeeId === 'B');
    expect(b?.perDay).toEqual([
      { date: '2026-09-21', grossCents: 50_000n, advancesCents: 20_000n, finalCents: 30_000n },
      { date: '2026-09-22', grossCents: 60_000n, advancesCents: 60_000n, finalCents: 0n },
      { date: '2026-09-26', grossCents: 40_000n, advancesCents: 10_000n, finalCents: 30_000n },
    ]);
    const a = result.payments.find((p) => p.employeeId === 'A');
    expect(a?.perDay.map((d) => d.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-24',
      '2026-09-26',
    ]);
  });

  it('reports the days of the week without any distribution', () => {
    expect(result.daysWithoutDistribution).toEqual(['2026-09-23', '2026-09-25', '2026-09-27']);
  });

  it('per envelope: gross - advances = net; sum of days = weekly total', () => {
    for (const payment of result.payments) {
      expect(payment.grossCents - payment.advancesCents).toBe(payment.netCents);
      expect(payment.perDay.reduce((s, d) => s + d.grossCents, 0n)).toBe(payment.grossCents);
      expect(payment.perDay.reduce((s, d) => s + d.finalCents, 0n)).toBe(payment.netCents);
    }
  });
});

describe('weekly settlement: missing days and special shapes', () => {
  it('a week with no distributions has no envelopes and 7 missing days', () => {
    const result = computeWeeklySettlement({ weekStart: WEEK, days: [] });
    expect(result.payments).toEqual([]);
    expect(result.totals).toEqual({ grossCents: 0n, advancesCents: 0n, netCents: 0n });
    expect(result.distributionCount).toBe(0);
    expect(result.daysWithoutDistribution).toHaveLength(7);
  });

  it('a week with a single day', () => {
    const result = computeWeeklySettlement({
      weekStart: WEEK,
      days: [day('2026-09-27', 'only', [si('A', 5_000n)])],
    });
    expect(result.payments.map((p) => p.netCents)).toEqual([5_000n]);
    expect(result.daysWithoutDistribution).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
  });

  it('two pools on the same day (per-team) add up in a single day entry', () => {
    const result = computeWeeklySettlement({
      weekStart: WEEK,
      days: [
        day('2026-09-21', 'd1-salon', [si('A', 100_000n)]),
        day('2026-09-21', 'd1-barra', [si('A', 20_000n, 5_000n)]),
      ],
    });
    const a = result.payments[0];
    expect(a?.grossCents).toBe(120_000n);
    expect(a?.advancesCents).toBe(5_000n);
    expect(a?.netCents).toBe(115_000n);
    expect(a?.perDay).toEqual([
      { date: '2026-09-21', grossCents: 120_000n, advancesCents: 5_000n, finalCents: 115_000n },
    ]);
    expect(result.distributionCount).toBe(2);
    expect(result.daysWithoutDistribution).toHaveLength(6);
  });

  it('employees with a zero gross for the whole week get no envelope', () => {
    const result = computeWeeklySettlement({
      weekStart: WEEK,
      days: [day('2026-09-21', 'd1', [si('A', 1_000n), si('D', 0n)])],
    });
    expect(result.payments.map((p) => p.employeeId)).toEqual(['A']);
  });

  it('a week that crosses a month boundary', () => {
    const result = computeWeeklySettlement({
      weekStart: '2026-09-28',
      days: [day('2026-09-30', 'd1', [si('A', 10n)]), day('2026-10-04', 'd2', [si('A', 20n)])],
    });
    expect(result.weekEnd).toBe('2026-10-04');
    expect(result.payments[0]?.netCents).toBe(30n);
    expect(result.daysWithoutDistribution).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('does not depend on the order of days or items', () => {
    const baseline = computeWeeklySettlement({ weekStart: WEEK, days: sampleWeek() });
    for (const seed of [1, 2, 3, 4, 5]) {
      const shuffled = permute(sampleWeek(), seed).map((d) => ({
        ...d,
        items: permute(d.items, seed + 50),
      }));
      expect(computeWeeklySettlement({ weekStart: WEEK, days: shuffled })).toEqual(baseline);
    }
  });
});

describe('weekly settlement: invalid input', () => {
  it('rejects a distribution outside the week', () => {
    expectCode(
      () =>
        computeWeeklySettlement({ weekStart: WEEK, days: [day('2026-09-28', 'x', [si('A', 1n)])] }),
      'INVALID_SETTLEMENT',
    );
    expectCode(
      () =>
        computeWeeklySettlement({ weekStart: WEEK, days: [day('2026-09-20', 'x', [si('A', 1n)])] }),
      'INVALID_SETTLEMENT',
    );
  });

  it('rejects duplicate distribution ids and duplicate employees in one distribution', () => {
    expectCode(
      () =>
        computeWeeklySettlement({
          weekStart: WEEK,
          days: [day('2026-09-21', 'x', [si('A', 1n)]), day('2026-09-22', 'x', [si('A', 1n)])],
        }),
      'DUPLICATE_ID',
    );
    expectCode(
      () =>
        computeWeeklySettlement({
          weekStart: WEEK,
          days: [day('2026-09-21', 'x', [si('A', 1n), si('A', 2n)])],
        }),
      'DUPLICATE_EMPLOYEE',
    );
  });

  it('rejects inconsistent items', () => {
    const inconsistent: SettledItem = {
      employeeId: 'A',
      grossCents: 100n,
      advancesCents: 10n,
      finalCents: 95n, // should be 90
    };
    expectCode(
      () =>
        computeWeeklySettlement({
          weekStart: WEEK,
          days: [day('2026-09-21', 'x', [inconsistent])],
        }),
      'INVALID_SETTLEMENT',
    );
    const overAdvanced: SettledItem = {
      employeeId: 'A',
      grossCents: 100n,
      advancesCents: 150n,
      finalCents: -50n,
    };
    expectCode(
      () =>
        computeWeeklySettlement({
          weekStart: WEEK,
          days: [day('2026-09-21', 'x', [overAdvanced])],
        }),
      'INVALID_SETTLEMENT',
    );
    const floatLike = {
      employeeId: 'A',
      grossCents: 10 as unknown as bigint,
      advancesCents: 0n,
      finalCents: 10 as unknown as bigint,
    };
    expectCode(
      () =>
        computeWeeklySettlement({ weekStart: WEEK, days: [day('2026-09-21', 'x', [floatLike])] }),
      'INVALID_SETTLEMENT',
    );
  });

  it('rejects invalid dates and empty ids', () => {
    expectCode(
      () => computeWeeklySettlement({ weekStart: '2026-02-30', days: [] }),
      'INVALID_DATE',
    );
    expectCode(
      () =>
        computeWeeklySettlement({ weekStart: WEEK, days: [day('2026-09-21', '', [si('A', 1n)])] }),
      'INVALID_SETTLEMENT',
    );
  });
});

describe('daily distributions -> weekly settlement (integration)', () => {
  const toSettledDay = (distributionId: string, result: DailyDistributionResult): SettledDay => ({
    date: result.date,
    distributionId,
    items: result.items.map((i) => ({
      employeeId: i.employeeId,
      grossCents: i.grossCents,
      advancesCents: i.advancesCents,
      finalCents: i.finalCents,
    })),
  });

  it('two employees over two days: envelope totals reconcile with the daily pools', () => {
    // Day 1 (Mon): roro 8h, leo 4h, pool 100_000 -> roro 66_667, leo 33_333
    // Day 2 (Tue): roro 4h, leo 8h, pool 100_000 -> roro 33_333, leo 66_667
    const d1 = computeDailyDistribution({
      date: '2026-09-21',
      tips: [ars(100_000n)],
      rows: [row('roro', '8'), row('leo', '4')],
    });
    const d2 = computeDailyDistribution({
      date: '2026-09-22',
      tips: [ars(100_000n)],
      rows: [row('roro', '4'), row('leo', '8')],
    });
    const week = computeWeeklySettlement({
      weekStart: WEEK,
      days: [toSettledDay('d1', d1), toSettledDay('d2', d2)],
    });
    expect(week.payments.map((p) => [p.employeeId, p.netCents])).toEqual([
      ['leo', 100_000n],
      ['roro', 100_000n],
    ]);
    expect(week.totals.grossCents).toBe(d1.totalCents + d2.totalCents);
    expect(week.totals.netCents).toBe(d1.totalFinalCents + d2.totalFinalCents);
  });

  it('an advance larger than day 1 flows through the days into the envelope', () => {
    // Day 1: pool $30.000, advance $40.000 -> day $0, $10.000 pending.
    // Day 2: pool $50.000 -> $10.000 recovered, day $40.000.
    // Week: gross $80.000, advances $40.000, envelope $40.000.
    const original: PendingAdvance[] = [
      { advanceId: 'a1', employeeId: 'roro', date: '2026-09-20', remainingCents: 4_000_000n },
    ];
    const d1 = computeDailyDistribution({
      date: '2026-09-21',
      tips: [ars(3_000_000n)],
      rows: [row('roro', '8')],
      pendingAdvances: original,
    });
    const d2 = computeDailyDistribution({
      date: '2026-09-22',
      tips: [ars(5_000_000n)],
      rows: [row('roro', '8')],
      pendingAdvances: nextPending(original, d1.advanceUpdates),
    });
    const week = computeWeeklySettlement({
      weekStart: WEEK,
      days: [toSettledDay('d1', d1), toSettledDay('d2', d2)],
    });
    const roro = week.payments[0];
    expect(roro?.grossCents).toBe(8_000_000n);
    expect(roro?.advancesCents).toBe(4_000_000n);
    expect(roro?.netCents).toBe(4_000_000n);
    expect(roro?.perDay).toEqual([
      { date: '2026-09-21', grossCents: 3_000_000n, advancesCents: 3_000_000n, finalCents: 0n },
      {
        date: '2026-09-22',
        grossCents: 5_000_000n,
        advancesCents: 1_000_000n,
        finalCents: 4_000_000n,
      },
    ]);
  });
});
