import { describe, expect, it } from 'vitest';
import {
  computeDailyDistribution,
  type DailyDistributionInput,
  type PendingAdvance,
  type TipInput,
  type WorkRow,
} from '../src';
import { DAY, ars, expectCode, itemOf, nextPending, permute, row, usd } from './helpers';

const run = (
  tips: TipInput[],
  rows: WorkRow[],
  pendingAdvances: PendingAdvance[] = [],
  date = DAY,
) => computeDailyDistribution({ date, tips, rows, pendingAdvances });

const grossOf = (result: ReturnType<typeof run>) =>
  Object.fromEntries(result.items.map((i) => [i.employeeId, i.grossCents]));

describe('basic distribution', () => {
  it('splits an exactly divisible pool', () => {
    // $900,00 = 90_000 cents. a: 6h x 1 = 60_000 pts; b: 3h x 1 = 30_000 pts; total 90_000 pts.
    // a = 90_000 x 60_000 / 90_000 = 60_000 ; b = 30_000
    const result = run([ars(90_000n)], [row('a', '6'), row('b', '3')]);
    expect(grossOf(result)).toEqual({ a: 60_000n, b: 30_000n });
    expect(result.totalCents).toBe(90_000n);
    expect(result.totalPointsE4).toBe(90_000n);
    expect(itemOf(result, 'a').percentageE6).toBe(666_667n); // 66.6667 %
    expect(itemOf(result, 'b').percentageE6).toBe(333_333n); // 33.3333 %
  });

  it('gives a single employee the whole pool', () => {
    const result = run([ars(12_345n)], [row('solo', '5')]);
    expect(grossOf(result)).toEqual({ solo: 12_345n });
    expect(itemOf(result, 'solo').percentageE6).toBe(1_000_000n);
  });

  it('echoes date and totals', () => {
    const result = run([ars(100n)], [row('a', '1')]);
    expect(result.date).toBe(DAY);
    expect(result.tipsArsCents).toBe(100n);
    expect(result.tipsUsdCents).toBe(0n);
    expect(result.totalAdvancesCents).toBe(0n);
    expect(result.totalFinalCents).toBe(100n);
    expect(result.advanceUpdates).toEqual([]);
  });
});

describe('points = hours x weight', () => {
  it('weights the position: 8h x 1.50, 8h x 1.00, 4h x 1.00', () => {
    // hoursE2 x weightE2: 800 x 150 = 120_000 ; 800 x 100 = 80_000 ; 400 x 100 = 40_000 ; total 240_000
    // Pool 240_000 cents -> shares equal the points: 120_000 / 80_000 / 40_000
    const result = run(
      [ars(240_000n)],
      [row('a', '8', '1.50'), row('b', '8', '1.00'), row('c', '4', '1.00')],
    );
    expect(result.items.map((i) => i.pointsE4)).toEqual([120_000n, 80_000n, 40_000n]);
    expect(result.items.map((i) => i.hoursE2)).toEqual([800n, 800n, 400n]);
    expect(result.items.map((i) => i.weightE2)).toEqual([150n, 100n, 100n]);
    expect(result.totalPointsE4).toBe(240_000n);
    expect(grossOf(result)).toEqual({ a: 120_000n, b: 80_000n, c: 40_000n });
  });

  it('percentages: 50 %, 33.3333 %, 16.6667 % (informational, rounded half-up)', () => {
    const result = run(
      [ars(240_000n)],
      [row('a', '8', '1.50'), row('b', '8', '1.00'), row('c', '4', '1.00')],
    );
    expect(result.items.map((i) => i.percentageE6)).toEqual([500_000n, 333_333n, 166_667n]);
  });

  it('supports decimal hours and decimal weights', () => {
    // 7.5h x 1.00 = 75_000 pts ; 2.5h x 1.00 = 25_000 pts ; pool $100,00 = 10_000 cents
    const hours = run([ars(10_000n)], [row('a', '7.5'), row('b', '2.5')]);
    expect(grossOf(hours)).toEqual({ a: 7_500n, b: 2_500n });

    // 8h x 1.25 = 100_000 pts ; 8h x 1.00 = 80_000 pts ; pool 180_000 cents
    const weights = run([ars(180_000n)], [row('a', '8', '1.25'), row('b', '8', '1.00')]);
    expect(grossOf(weights)).toEqual({ a: 100_000n, b: 80_000n });
  });

  it('ignores employees with zero hours (they are not in the result)', () => {
    const result = run([ars(5_000n)], [row('a', '8'), row('b', '0'), row('c', '0.00')]);
    expect(result.items.map((i) => i.employeeId)).toEqual(['a']);
    expect(grossOf(result)).toEqual({ a: 5_000n });
  });

  it('accepts exactly 24 hours', () => {
    expect(() => run([ars(100n)], [row('a', '24'), row('b', '24.00')])).not.toThrow();
  });
});

describe('largest remainder method', () => {
  it('gives the leftover cent to the biggest remainder', () => {
    // a: 8h = 80_000 pts ; b: 4h = 40_000 pts ; P = 120_000 ; pool 100_000 cents
    // a: 100_000 x 80_000 = 8e9 -> base 66_666, remainder 80_000
    // b: 100_000 x 40_000 = 4e9 -> base 33_333, remainder 40_000
    // leftover = 100_000 - 99_999 = 1 -> a has the larger remainder
    const result = run([ars(100_000n)], [row('a', '8'), row('b', '4')]);
    expect(grossOf(result)).toEqual({ a: 66_667n, b: 33_333n });
  });

  it('the remainder wins over the employee id (later id can get the cent)', () => {
    const result = run([ars(100_000n)], [row('zed', '8'), row('amy', '4')]);
    expect(grossOf(result)).toEqual({ amy: 33_333n, zed: 66_667n });
  });

  it('breaks perfect ties by employee id, independent of input order', () => {
    // 3 equal employees, pool 100 cents: base 33 each, remainder equal, leftover 1 -> "a"
    const result = run([ars(100n)], [row('c', '8'), row('a', '8'), row('b', '8')]);
    expect(grossOf(result)).toEqual({ a: 34n, b: 33n, c: 33n });
  });

  it('distributes two leftover cents to the first two ids on a tie', () => {
    // pool 101: base 33 each (99), leftover 2 -> "a" and "b"
    const result = run([ars(101n)], [row('c', '8'), row('a', '8'), row('b', '8')]);
    expect(grossOf(result)).toEqual({ a: 34n, b: 34n, c: 33n });
  });

  it('the sum of the shares always equals the pool, to the cent', () => {
    for (const pool of [1n, 2n, 3n, 7n, 99n, 100n, 101n, 999_999n, 1_000_001n]) {
      const result = run(
        [ars(pool)],
        [row('a', '7.5', '1.25'), row('b', '3'), row('c', '8.25', '1.5')],
      );
      const sum = result.items.reduce((acc, i) => acc + i.grossCents, 0n);
      expect(sum).toBe(pool);
      expect(result.totalCents).toBe(pool);
    }
  });

  it('a pool smaller than the number of employees still adds up exactly', () => {
    // 2 cents between 3 equal employees: a and b get 1, c gets 0
    const result = run([ars(2n)], [row('a', '8'), row('b', '8'), row('c', '8')]);
    expect(grossOf(result)).toEqual({ a: 1n, b: 1n, c: 0n });
  });

  it('is exact for pools beyond Number.MAX_SAFE_INTEGER', () => {
    // 9_007_199_254_740_993 / 3 = 3_002_399_751_580_331 exactly
    const result = run(
      [ars(9_007_199_254_740_993n)],
      [row('a', '8'), row('b', '8'), row('c', '8')],
    );
    expect(grossOf(result)).toEqual({
      a: 3_002_399_751_580_331n,
      b: 3_002_399_751_580_331n,
      c: 3_002_399_751_580_331n,
    });
  });
});

describe('USD -> ARS', () => {
  it('converts USD with the given rate and keeps the original data', () => {
    // ARS $1.000,00 (100_000 cents) + USD 50,00 x 1180.00 = ARS 59.000,00 (5_900_000 cents)
    const result = run([ars(100_000n), usd(5_000n, '1180.00')], [row('a', '8')]);
    expect(result.tipsArsCents).toBe(100_000n);
    expect(result.tipsUsdCents).toBe(5_000n);
    expect(result.totalCents).toBe(6_000_000n);
    expect(result.tips).toEqual([
      { currency: 'ARS', amountCents: 100_000n, rateE6: null, amountArsCents: 100_000n },
      {
        currency: 'USD',
        amountCents: 5_000n,
        rateE6: 1_180_000_000n,
        amountArsCents: 5_900_000n,
      },
    ]);
    expect(grossOf(result)).toEqual({ a: 6_000_000n });
  });

  it('each USD tip keeps its own rate', () => {
    // 10,00 USD x 1000.00 = 1_000_000 ; 10,00 USD x 1100.00 = 1_100_000 ; total 2_100_000
    const result = run([usd(1_000n, '1000.00'), usd(1_000n, '1100.00')], [row('a', '8')]);
    expect(result.tips.map((t) => t.amountArsCents)).toEqual([1_000_000n, 1_100_000n]);
    expect(result.totalCents).toBe(2_100_000n);
    expect(result.tipsUsdCents).toBe(2_000n);
  });

  it('rounds each USD tip once (half-up) before adding', () => {
    // 0.01 USD x 1180.50 -> 1181 cents (each). Two tips -> 2362, not round(2 x 1180.5) = 2361.
    const result = run([usd(1n, '1180.50'), usd(1n, '1180.50')], [row('a', '8')]);
    expect(result.totalCents).toBe(2_362n);
  });
});

describe('advances at close of the day', () => {
  const advance = (
    advanceId: string,
    employeeId: string,
    remainingCents: bigint,
    date = '2026-09-20',
  ): PendingAdvance => ({ advanceId, employeeId, date, remainingCents });

  it('deducts an advance smaller than the share', () => {
    // pool 100_000 -> a 66_667, b 33_333. a has an advance of 10_000.
    const result = run(
      [ars(100_000n)],
      [row('a', '8'), row('b', '4')],
      [advance('x1', 'a', 10_000n)],
    );
    const a = itemOf(result, 'a');
    expect([a.grossCents, a.advancesCents, a.finalCents]).toEqual([66_667n, 10_000n, 56_667n]);
    expect(a.applications).toEqual([{ advanceId: 'x1', cents: 10_000n }]);
    expect(a.pendingBalanceAfterCents).toBe(0n);
    const b = itemOf(result, 'b');
    expect([b.advancesCents, b.finalCents]).toEqual([0n, 33_333n]);
    expect(result.totalAdvancesCents).toBe(10_000n);
    expect(result.totalFinalCents).toBe(90_000n);
    expect(result.advanceUpdates).toEqual([
      { advanceId: 'x1', appliedCents: 10_000n, remainingAfterCents: 0n },
    ]);
  });

  it('advance larger than the day: day = $0, pending balance recorded ($30.000 tip, $40.000 advance)', () => {
    const result = run([ars(3_000_000n)], [row('roro', '8')], [advance('a1', 'roro', 4_000_000n)]);
    const roro = itemOf(result, 'roro');
    expect(roro.grossCents).toBe(3_000_000n);
    expect(roro.advancesCents).toBe(3_000_000n);
    expect(roro.finalCents).toBe(0n);
    expect(roro.pendingBalanceAfterCents).toBe(1_000_000n); // $10.000 pending
    expect(result.advanceUpdates).toEqual([
      { advanceId: 'a1', appliedCents: 3_000_000n, remainingAfterCents: 1_000_000n },
    ]);
    expect(result.totalFinalCents).toBe(0n);
  });

  it('a later day applies the pending balance', () => {
    const day1 = run([ars(3_000_000n)], [row('roro', '8')], [advance('a1', 'roro', 4_000_000n)]);
    const pending = nextPending([advance('a1', 'roro', 4_000_000n)], day1.advanceUpdates);
    expect(pending.map((p) => p.remainingCents)).toEqual([1_000_000n]);

    // Day 2: $50.000 tip, $10.000 balance -> final $40.000, nothing pending.
    const day2 = run([ars(5_000_000n)], [row('roro', '8')], pending, '2026-09-25');
    const roro = itemOf(day2, 'roro');
    expect([roro.advancesCents, roro.finalCents, roro.pendingBalanceAfterCents]).toEqual([
      1_000_000n,
      4_000_000n,
      0n,
    ]);
    expect(day2.advanceUpdates).toEqual([
      { advanceId: 'a1', appliedCents: 1_000_000n, remainingAfterCents: 0n },
    ]);
  });

  it('a balance can take several days to be recovered, never exceeding the advance', () => {
    const original = [advance('a1', 'roro', 4_000_000n)];
    // Day 1: 3_000_000 available -> applies 3_000_000, remaining 1_000_000
    const d1 = run([ars(3_000_000n)], [row('roro', '8')], original, '2026-09-21');
    const p1 = nextPending(original, d1.advanceUpdates);
    // Day 2: only 400_000 available -> applies 400_000, remaining 600_000, final 0
    const d2 = run([ars(400_000n)], [row('roro', '8')], p1, '2026-09-22');
    expect(itemOf(d2, 'roro').finalCents).toBe(0n);
    const p2 = nextPending(p1, d2.advanceUpdates);
    expect(p2.map((p) => p.remainingCents)).toEqual([600_000n]);
    // Day 3: 1_000_000 available -> applies the last 600_000, final 400_000
    const d3 = run([ars(1_000_000n)], [row('roro', '8')], p2, '2026-09-23');
    expect(itemOf(d3, 'roro').advancesCents).toBe(600_000n);
    expect(itemOf(d3, 'roro').finalCents).toBe(400_000n);
    expect(nextPending(p2, d3.advanceUpdates)).toEqual([]);

    const totalApplied =
      itemOf(d1, 'roro').advancesCents +
      itemOf(d2, 'roro').advancesCents +
      itemOf(d3, 'roro').advancesCents;
    expect(totalApplied).toBe(4_000_000n); // exactly the advance, no more
  });

  it('caps at the employee share and keeps the difference pending', () => {
    // b's share is 33_333; advance 50_000 -> applies 33_333, pending 16_667
    const result = run(
      [ars(100_000n)],
      [row('a', '8'), row('b', '4')],
      [advance('x2', 'b', 50_000n)],
    );
    const b = itemOf(result, 'b');
    expect([b.advancesCents, b.finalCents, b.pendingBalanceAfterCents]).toEqual([
      33_333n,
      0n,
      16_667n,
    ]);
  });

  it('applies several advances of one employee oldest-first and reports each update', () => {
    const result = run(
      [ars(1_000_000n)],
      [row('roro', '8')],
      [
        advance('a2', 'roro', 500_000n, '2026-09-02'),
        advance('a1', 'roro', 800_000n, '2026-09-01'),
      ],
    );
    expect(itemOf(result, 'roro').applications).toEqual([
      { advanceId: 'a1', cents: 800_000n },
      { advanceId: 'a2', cents: 200_000n },
    ]);
    expect(result.advanceUpdates).toEqual([
      { advanceId: 'a1', appliedCents: 800_000n, remainingAfterCents: 0n },
      { advanceId: 'a2', appliedCents: 200_000n, remainingAfterCents: 300_000n },
    ]);
  });

  it('leaves advances of absent employees and future-dated advances untouched', () => {
    const result = run(
      [ars(100_000n)],
      [row('a', '8')],
      [advance('other', 'leo', 5_000n), advance('future', 'a', 5_000n, '2026-09-30')],
    );
    expect(itemOf(result, 'a').advancesCents).toBe(0n);
    expect(result.advanceUpdates).toEqual([]);
  });
});

describe('empty and degenerate distributions', () => {
  it('without employees', () => {
    expectCode(() => run([ars(100n)], []), 'NO_EMPLOYEES');
  });

  it('without hours (everyone at zero)', () => {
    expectCode(() => run([ars(100n)], [row('a', '0'), row('b', '0.00')]), 'NO_HOURS');
  });

  it('without tips', () => {
    expectCode(() => run([], [row('a', '8')]), 'NO_TIPS');
  });
});

describe('invalid values', () => {
  it.each(['24.01', '25', '-1', 'abc', '7.555', '', '1e2', ' 8'])('rejects hours "%s"', (hours) => {
    expectCode(() => run([ars(100n)], [row('a', hours)]), 'INVALID_HOURS');
  });

  it('rejects hours that are not strings', () => {
    expectCode(() => run([ars(100n)], [row('a', 8 as unknown as string)]), 'INVALID_HOURS');
  });

  it.each(['0', '0.00', '-1', 'abc', '1.234', ''])('rejects weight "%s"', (weight) => {
    expectCode(() => run([ars(100n)], [row('a', '8', weight)]), 'INVALID_WEIGHT');
  });

  it('validates the weight even when the hours are zero', () => {
    expectCode(() => run([ars(100n)], [row('a', '8'), row('b', '0', '0')]), 'INVALID_WEIGHT');
  });

  it('rejects duplicate employees (even if one has zero hours)', () => {
    expectCode(() => run([ars(100n)], [row('a', '8'), row('a', '0')]), 'DUPLICATE_EMPLOYEE');
  });

  it('rejects empty employee ids', () => {
    expectCode(() => run([ars(100n)], [row('', '8')]), 'INVALID_EMPLOYEE');
  });

  it('rejects impossible or malformed dates', () => {
    expectCode(() => run([ars(100n)], [row('a', '8')], [], '2026-02-30'), 'INVALID_DATE');
    expectCode(() => run([ars(100n)], [row('a', '8')], [], '24/09/2026'), 'INVALID_DATE');
  });

  it('rejects non-positive and non-bigint tip amounts', () => {
    expectCode(() => run([ars(0n)], [row('a', '8')]), 'INVALID_AMOUNT');
    expectCode(() => run([ars(-5n)], [row('a', '8')]), 'INVALID_AMOUNT');
    expectCode(
      () => run([{ currency: 'ARS', amountCents: 100 as unknown as bigint }], [row('a', '8')]),
      'INVALID_AMOUNT',
    );
  });

  it('rejects USD tips without a rate and ARS tips with one', () => {
    expectCode(
      () => run([{ currency: 'USD', amountCents: 100n }], [row('a', '8')]),
      'INVALID_RATE',
    );
    expectCode(
      () => run([{ currency: 'ARS', amountCents: 100n, rate: '1180.00' }], [row('a', '8')]),
      'INVALID_RATE',
    );
  });

  it('rejects zero, negative or malformed rates', () => {
    expectCode(() => run([usd(100n, '0')], [row('a', '8')]), 'INVALID_RATE');
    expectCode(() => run([usd(100n, '-1')], [row('a', '8')]), 'INVALID_RATE');
    expectCode(() => run([usd(100n, 'abc')], [row('a', '8')]), 'INVALID_RATE');
  });

  it('rejects unsupported currencies', () => {
    expectCode(
      () => run([{ currency: 'EUR' as 'ARS', amountCents: 100n }], [row('a', '8')]),
      'INVALID_TIP',
    );
  });

  it('rejects invalid pending advances', () => {
    const bad: PendingAdvance = { advanceId: 'x', employeeId: 'a', date: DAY, remainingCents: -1n };
    expectCode(() => run([ars(100n)], [row('a', '8')], [bad]), 'INVALID_ADVANCE');
  });
});

describe('determinism and order independence', () => {
  const tips = [ars(1_234_567n), usd(3_333n, '1180.55')];
  const rows = [
    row('leo', '8', '1.25'),
    row('roro', '7.5'),
    row('marcos', '4', '0.75'),
    row('ana', '6.25', '1.5'),
    row('zoe', '0'),
  ];
  const advances: PendingAdvance[] = [
    { advanceId: 'x3', employeeId: 'leo', date: '2026-09-02', remainingCents: 900_000n },
    { advanceId: 'x1', employeeId: 'leo', date: '2026-09-01', remainingCents: 100_000n },
    { advanceId: 'x2', employeeId: 'marcos', date: '2026-09-10', remainingCents: 5_000_000n },
  ];
  const input: DailyDistributionInput = { date: DAY, tips, rows, pendingAdvances: advances };

  it('same input, same output (run twice)', () => {
    expect(computeDailyDistribution(input)).toEqual(computeDailyDistribution(input));
  });

  it('does not mutate its input', () => {
    const frozen: DailyDistributionInput = {
      date: DAY,
      tips: Object.freeze([...tips]),
      rows: Object.freeze([...rows]),
      pendingAdvances: Object.freeze([...advances]),
    };
    expect(() => computeDailyDistribution(frozen)).not.toThrow();
    expect(rows.map((r) => r.employeeId)).toEqual(['leo', 'roro', 'marcos', 'ana', 'zoe']);
    expect(advances.map((a) => a.advanceId)).toEqual(['x3', 'x1', 'x2']);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'shuffling rows and advances (seed %i) changes nothing',
    (seed) => {
      const baseline = computeDailyDistribution(input);
      const shuffled = computeDailyDistribution({
        date: DAY,
        tips: permute(tips, seed),
        rows: permute(rows, seed + 100),
        pendingAdvances: permute(advances, seed + 200),
      });
      expect(shuffled.items).toEqual(baseline.items);
      expect(shuffled.advanceUpdates).toEqual(baseline.advanceUpdates);
      expect(shuffled.totalCents).toBe(baseline.totalCents);
      expect(shuffled.totalPointsE4).toBe(baseline.totalPointsE4);
      expect(shuffled.totalAdvancesCents).toBe(baseline.totalAdvancesCents);
      expect(shuffled.totalFinalCents).toBe(baseline.totalFinalCents);
    },
  );

  it('returns items sorted by employee id', () => {
    expect(computeDailyDistribution(input).items.map((i) => i.employeeId)).toEqual([
      'ana',
      'leo',
      'marcos',
      'roro',
    ]);
  });
});
