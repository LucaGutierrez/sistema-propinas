import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeDailyDistribution,
  computeWeeklySettlement,
  convertUsdToArs,
  formatFixed,
  parseRate,
  type PendingAdvance,
  type SettledDay,
  type SettledItem,
  type TipInput,
  type WorkRow,
} from '../src';
import { permute } from './helpers';

const RUNS = { numRuns: 300 };
const DAY = '2026-09-24';

const hoursArb = fc.integer({ min: 1, max: 2400 }).map((n) => formatFixed(BigInt(n), 2));
const weightArb = fc.integer({ min: 1, max: 1000 }).map((n) => formatFixed(BigInt(n), 2));

const rowsArb = fc.uniqueArray(
  fc.record({
    employeeId: fc.string({ minLength: 1, maxLength: 5 }),
    hours: hoursArb,
    weight: weightArb,
  }),
  { selector: (r) => r.employeeId, minLength: 1, maxLength: 8 },
);

const poolArb = fc.bigInt({ min: 1n, max: 10n ** 15n });

const advanceSeedArb = fc.record({
  employeeIndex: fc.nat(20),
  day: fc.integer({ min: 1, max: 30 }),
  remaining: fc.bigInt({ min: 1n, max: 10n ** 13n }),
});

const scenarioArb = fc.record({
  rows: rowsArb,
  pool: poolArb,
  advanceSeeds: fc.array(advanceSeedArb, { maxLength: 10 }),
});

interface Scenario {
  rows: WorkRow[];
  pool: bigint;
  advanceSeeds: { employeeIndex: number; day: number; remaining: bigint }[];
}

function buildAdvances(scenario: Scenario): PendingAdvance[] {
  return scenario.advanceSeeds.map((seed, index) => {
    // Some advances belong to employees that are not in the distribution.
    const pick = seed.employeeIndex % (scenario.rows.length + 1);
    const employeeId = scenario.rows[pick]?.employeeId ?? 'absent-employee';
    return {
      advanceId: `adv-${index}`,
      employeeId,
      date: `2026-09-${String(seed.day).padStart(2, '0')}`,
      remainingCents: seed.remaining,
    };
  });
}

const tipsOf = (pool: bigint): TipInput[] => [{ currency: 'ARS', amountCents: pool }];

describe('property: daily distribution', () => {
  it('the shares always add up to the pool, exactly, and are never negative', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const result = computeDailyDistribution({
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: scenario.rows,
        });
        const sum = result.items.reduce((acc, i) => acc + i.grossCents, 0n);
        expect(sum).toBe(scenario.pool);
        for (const item of result.items) {
          expect(item.grossCents >= 0n).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('each share is within one cent of the exact proportional amount', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const result = computeDailyDistribution({
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: scenario.rows,
        });
        const P = result.totalPointsE4;
        for (const item of result.items) {
          const exactTimesP = scenario.pool * item.pointsE4;
          const shareTimesP = item.grossCents * P;
          const diff =
            exactTimesP > shareTimesP ? exactTimesP - shareTimesP : shareTimesP - exactTimesP;
          expect(diff < P).toBe(true); // |share - exact| < 1 cent
        }
      }),
      RUNS,
    );
  });

  it('more points never receive less than fewer points', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const result = computeDailyDistribution({
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: scenario.rows,
        });
        for (const a of result.items) {
          for (const b of result.items) {
            if (a.pointsE4 > b.pointsE4) {
              expect(a.grossCents >= b.grossCents).toBe(true);
            }
          }
        }
      }),
      RUNS,
    );
  });

  it('the result does not depend on the order of rows or advances', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 1_000_000 }), (scenario, seed) => {
        const advances = buildAdvances(scenario);
        const baseline = computeDailyDistribution({
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: scenario.rows,
          pendingAdvances: advances,
        });
        const shuffled = computeDailyDistribution({
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: permute(scenario.rows, seed),
          pendingAdvances: permute(advances, seed + 1),
        });
        expect(shuffled).toEqual(baseline);
      }),
      RUNS,
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const input = {
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: scenario.rows,
          pendingAdvances: buildAdvances(scenario),
        };
        expect(computeDailyDistribution(input)).toEqual(computeDailyDistribution(input));
      }),
      RUNS,
    );
  });

  it('advances: final = gross - advances, never negative, never more than what exists', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const advances = buildAdvances(scenario);
        const result = computeDailyDistribution({
          date: DAY,
          tips: tipsOf(scenario.pool),
          rows: scenario.rows,
          pendingAdvances: advances,
        });

        for (const item of result.items) {
          expect(item.finalCents).toBe(item.grossCents - item.advancesCents);
          expect(item.finalCents >= 0n).toBe(true);
          expect(item.advancesCents <= item.grossCents).toBe(true);
          expect(item.applications.reduce((s, a) => s + a.cents, 0n)).toBe(item.advancesCents);

          // Conservation: applied + still-pending = balance of the eligible advances.
          const eligible = advances
            .filter((a) => a.employeeId === item.employeeId && a.date <= DAY)
            .reduce((s, a) => s + a.remainingCents, 0n);
          expect(item.advancesCents + item.pendingBalanceAfterCents).toBe(eligible);
          // The advance is taken up to the share; whatever is left over stays pending.
          expect(item.advancesCents).toBe(eligible < item.grossCents ? eligible : item.grossCents);
        }

        for (const update of result.advanceUpdates) {
          const original = advances.find((a) => a.advanceId === update.advanceId);
          expect(original).toBeDefined();
          expect(update.appliedCents > 0n).toBe(true);
          expect(update.remainingAfterCents >= 0n).toBe(true);
          expect(update.appliedCents + update.remainingAfterCents).toBe(original?.remainingCents);
          expect((original?.date ?? '') <= DAY).toBe(true);
        }

        expect(result.totalAdvancesCents + result.totalFinalCents).toBe(scenario.pool);
      }),
      RUNS,
    );
  });
});

describe('property: USD -> ARS conversion', () => {
  it('is within half a cent of the exact value', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 5_000_000_000n }), // rate 0.000001 .. 5000.000000
        (usdCents, rateE6) => {
          const rate = formatFixed(rateE6, 6);
          const ars = convertUsdToArs(usdCents, rate);
          const exactE6 = usdCents * parseRate(rate); // exact value in cents x 10^6
          const scaled = ars * 1_000_000n;
          const diff = scaled > exactE6 ? scaled - exactE6 : exactE6 - scaled;
          expect(diff * 2n <= 1_000_000n).toBe(true);
        },
      ),
      RUNS,
    );
  });
});

describe('property: weekly settlement', () => {
  const itemsArb = fc.uniqueArray(
    fc.record({
      employeeIndex: fc.integer({ min: 0, max: 4 }),
      gross: fc.bigInt({ min: 0n, max: 10n ** 12n }),
      advancePercent: fc.integer({ min: 0, max: 100 }),
    }),
    { selector: (i) => i.employeeIndex, minLength: 1, maxLength: 5 },
  );

  const weekArb = fc.array(
    fc.record({ dayOffset: fc.integer({ min: 0, max: 6 }), items: itemsArb }),
    {
      maxLength: 10,
    },
  );

  const toDays = (
    week: {
      dayOffset: number;
      items: { employeeIndex: number; gross: bigint; advancePercent: number }[];
    }[],
  ): SettledDay[] =>
    week.map((d, index) => ({
      date: `2026-09-${String(21 + d.dayOffset).padStart(2, '0')}`,
      distributionId: `dist-${index}`,
      items: d.items.map((i): SettledItem => {
        const advancesCents = (i.gross * BigInt(i.advancePercent)) / 100n;
        return {
          employeeId: `emp-${i.employeeIndex}`,
          grossCents: i.gross,
          advancesCents,
          finalCents: i.gross - advancesCents,
        };
      }),
    }));

  it('accumulates exactly, without creating or losing a cent', () => {
    fc.assert(
      fc.property(weekArb, (week) => {
        const days = toDays(week);
        const result = computeWeeklySettlement({ weekStart: '2026-09-21', days });

        const allItems = days.flatMap((d) => d.items);
        const sum = (pick: (i: SettledItem) => bigint) =>
          allItems.reduce((s, i) => s + pick(i), 0n);

        expect(result.totals.grossCents).toBe(sum((i) => i.grossCents));
        expect(result.totals.advancesCents).toBe(sum((i) => i.advancesCents));
        expect(result.totals.netCents).toBe(sum((i) => i.finalCents));
        expect(result.totals.grossCents - result.totals.advancesCents).toBe(result.totals.netCents);

        for (const payment of result.payments) {
          expect(payment.grossCents > 0n).toBe(true);
          expect(payment.netCents >= 0n).toBe(true);
          expect(payment.grossCents - payment.advancesCents).toBe(payment.netCents);
          expect(payment.perDay.reduce((s, d) => s + d.grossCents, 0n)).toBe(payment.grossCents);
          expect(payment.perDay.reduce((s, d) => s + d.finalCents, 0n)).toBe(payment.netCents);
        }

        const withDistribution = new Set(days.map((d) => d.date));
        expect(result.daysWithoutDistribution.length + withDistribution.size).toBe(7);
        expect(result.distributionCount).toBe(days.length);
      }),
      RUNS,
    );
  });

  it('does not depend on the order of the days', () => {
    fc.assert(
      fc.property(weekArb, fc.integer({ min: 1, max: 1_000_000 }), (week, seed) => {
        const days = toDays(week);
        const baseline = computeWeeklySettlement({ weekStart: '2026-09-21', days });
        const shuffled = computeWeeklySettlement({
          weekStart: '2026-09-21',
          days: permute(days, seed),
        });
        expect(shuffled).toEqual(baseline);
      }),
      RUNS,
    );
  });
});
