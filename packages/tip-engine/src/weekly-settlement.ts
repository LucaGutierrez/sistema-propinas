import { EngineError } from './errors';
import type {
  PaymentDayBreakdown,
  SettledDay,
  WeeklyPaymentResult,
  WeeklySettlementInput,
  WeeklySettlementResult,
} from './types';
import { addDays, assertIsoDate, datesInRange } from './week';

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertBigintCents(value: bigint, label: string): void {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new EngineError('INVALID_SETTLEMENT', `${label} must be a non-negative bigint`);
  }
}

interface Accumulator {
  grossCents: bigint;
  advancesCents: bigint;
  finalCents: bigint;
  perDay: Map<string, PaymentDayBreakdown>;
}

/**
 * Accumulates closed daily distributions into one payment (envelope) per employee.
 * It only adds up what each day already computed: no recalculation, no rounding.
 */
export function computeWeeklySettlement(input: WeeklySettlementInput): WeeklySettlementResult {
  assertIsoDate(input.weekStart);
  const weekStart = input.weekStart;
  const weekEnd = addDays(weekStart, 6n);

  const distributionIds = new Set<string>();
  const datesWithDistribution = new Set<string>();
  const byEmployee = new Map<string, Accumulator>();

  for (const day of input.days as readonly SettledDay[]) {
    assertIsoDate(day.date);
    if (day.date < weekStart || day.date > weekEnd) {
      throw new EngineError(
        'INVALID_SETTLEMENT',
        `Distribution ${day.distributionId} (${day.date}) is outside the week ${weekStart}..${weekEnd}`,
      );
    }
    if (typeof day.distributionId !== 'string' || day.distributionId === '') {
      throw new EngineError('INVALID_SETTLEMENT', 'Distribution id must be a non-empty string');
    }
    if (distributionIds.has(day.distributionId)) {
      throw new EngineError('DUPLICATE_ID', `Duplicate distribution id: ${day.distributionId}`);
    }
    distributionIds.add(day.distributionId);
    datesWithDistribution.add(day.date);

    const employeesInDay = new Set<string>();
    for (const item of day.items) {
      if (typeof item.employeeId !== 'string' || item.employeeId === '') {
        throw new EngineError('INVALID_EMPLOYEE', 'Employee id must be a non-empty string');
      }
      if (employeesInDay.has(item.employeeId)) {
        throw new EngineError(
          'DUPLICATE_EMPLOYEE',
          `Employee ${item.employeeId} appears twice in distribution ${day.distributionId}`,
        );
      }
      employeesInDay.add(item.employeeId);

      assertBigintCents(item.grossCents, 'grossCents');
      assertBigintCents(item.advancesCents, 'advancesCents');
      assertBigintCents(item.finalCents, 'finalCents');
      if (
        item.advancesCents > item.grossCents ||
        item.finalCents !== item.grossCents - item.advancesCents
      ) {
        throw new EngineError(
          'INVALID_SETTLEMENT',
          `Inconsistent item for ${item.employeeId} in ${day.distributionId}: final must equal gross - advances`,
        );
      }

      let acc = byEmployee.get(item.employeeId);
      if (!acc) {
        acc = { grossCents: 0n, advancesCents: 0n, finalCents: 0n, perDay: new Map() };
        byEmployee.set(item.employeeId, acc);
      }
      acc.grossCents += item.grossCents;
      acc.advancesCents += item.advancesCents;
      acc.finalCents += item.finalCents;

      const dayEntry = acc.perDay.get(day.date) ?? {
        date: day.date,
        grossCents: 0n,
        advancesCents: 0n,
        finalCents: 0n,
      };
      dayEntry.grossCents += item.grossCents;
      dayEntry.advancesCents += item.advancesCents;
      dayEntry.finalCents += item.finalCents;
      acc.perDay.set(day.date, dayEntry);
    }
  }

  const payments: WeeklyPaymentResult[] = [...byEmployee.entries()]
    .filter(([, acc]) => acc.grossCents > 0n)
    .map(([employeeId, acc]) => ({
      employeeId,
      grossCents: acc.grossCents,
      advancesCents: acc.advancesCents,
      netCents: acc.finalCents,
      perDay: [...acc.perDay.values()].sort((a, b) => compareStrings(a.date, b.date)),
    }))
    .sort((a, b) => compareStrings(a.employeeId, b.employeeId));

  const totals = payments.reduce(
    (sum, p) => ({
      grossCents: sum.grossCents + p.grossCents,
      advancesCents: sum.advancesCents + p.advancesCents,
      netCents: sum.netCents + p.netCents,
    }),
    { grossCents: 0n, advancesCents: 0n, netCents: 0n },
  );

  return {
    weekStart,
    weekEnd,
    payments,
    totals,
    distributionCount: distributionIds.size,
    daysWithoutDistribution: datesInRange(weekStart, weekEnd).filter(
      (date) => !datesWithDistribution.has(date),
    ),
  };
}
