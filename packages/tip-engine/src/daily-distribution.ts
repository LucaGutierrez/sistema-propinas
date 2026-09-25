import { allocateAdvances, validatePendingAdvances } from './advances';
import { EngineError, withCode } from './errors';
import { convertUsdToArs, parseRate } from './exchange';
import { HOURS_SCALE, PERCENT_SCALE, WEIGHT_SCALE, parseFixed, pow10 } from './fixed';
import { divRoundHalfUp } from './money';
import type {
  AdvanceAllocation,
  AdvanceUpdate,
  ConvertedTip,
  DailyDistributionInput,
  DailyDistributionResult,
  DailyItemResult,
  TipInput,
  WorkRow,
} from './types';
import { assertIsoDate } from './week';

const MAX_HOURS_E2 = 2400n; // 24.00 hours

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function convertTips(tips: readonly TipInput[]): ConvertedTip[] {
  if (tips.length === 0) {
    throw new EngineError('NO_TIPS', 'A daily distribution needs at least one tip entry');
  }
  return tips.map((tip): ConvertedTip => {
    if (tip.currency !== 'ARS' && tip.currency !== 'USD') {
      throw new EngineError('INVALID_TIP', `Unsupported currency: ${String(tip.currency)}`);
    }
    if (typeof tip.amountCents !== 'bigint' || tip.amountCents <= 0n) {
      throw new EngineError('INVALID_AMOUNT', 'Tip amount must be a bigint greater than zero');
    }
    if (tip.currency === 'ARS') {
      if (tip.rate !== undefined) {
        throw new EngineError('INVALID_RATE', 'ARS tips must not carry an exchange rate');
      }
      return {
        currency: 'ARS',
        amountCents: tip.amountCents,
        rateE6: null,
        amountArsCents: tip.amountCents,
      };
    }
    if (tip.rate === undefined) {
      throw new EngineError('INVALID_RATE', 'USD tips require an exchange rate');
    }
    return {
      currency: 'USD',
      amountCents: tip.amountCents,
      rateE6: parseRate(tip.rate),
      amountArsCents: convertUsdToArs(tip.amountCents, tip.rate),
    };
  });
}

interface WorkedRow {
  employeeId: string;
  hoursE2: bigint;
  weightE2: bigint;
  pointsE4: bigint;
}

function parseRows(rows: readonly WorkRow[]): WorkedRow[] {
  if (rows.length === 0) {
    throw new EngineError('NO_EMPLOYEES', 'A daily distribution needs at least one employee');
  }
  const seen = new Set<string>();
  const worked: WorkedRow[] = [];
  for (const row of rows) {
    if (typeof row.employeeId !== 'string' || row.employeeId === '') {
      throw new EngineError('INVALID_EMPLOYEE', 'Employee id must be a non-empty string');
    }
    if (seen.has(row.employeeId)) {
      throw new EngineError('DUPLICATE_EMPLOYEE', `Employee listed twice: ${row.employeeId}`);
    }
    seen.add(row.employeeId);

    const hoursE2 = withCode('INVALID_HOURS', () => parseFixed(row.hours, HOURS_SCALE));
    if (hoursE2 > MAX_HOURS_E2) {
      throw new EngineError('INVALID_HOURS', `Hours cannot exceed 24 (${row.employeeId})`);
    }
    const weightE2 = withCode('INVALID_WEIGHT', () => parseFixed(row.weight, WEIGHT_SCALE));
    if (weightE2 <= 0n) {
      throw new EngineError(
        'INVALID_WEIGHT',
        `Weight must be greater than zero (${row.employeeId})`,
      );
    }
    if (hoursE2 > 0n) {
      worked.push({ employeeId: row.employeeId, hoursE2, weightE2, pointsE4: hoursE2 * weightE2 });
    }
  }
  if (worked.length === 0) {
    throw new EngineError('NO_HOURS', 'No employee has hours worked; nothing to distribute');
  }
  return worked;
}

/**
 * Largest-remainder split of `totalCents` proportional to points. Exact: the shares always sum
 * to `totalCents`. Ties on the remainder go to more points, then to the lower employee id.
 */
function splitByLargestRemainder(
  totalCents: bigint,
  rows: readonly WorkedRow[],
  totalPointsE4: bigint,
): Map<string, bigint> {
  const parts = rows.map((row) => {
    const numerator = totalCents * row.pointsE4;
    return {
      row,
      base: numerator / totalPointsE4,
      remainder: numerator % totalPointsE4,
    };
  });

  const baseSum = parts.reduce((sum, part) => sum + part.base, 0n);
  const leftover = totalCents - baseSum;
  if (leftover < 0n || leftover >= BigInt(rows.length)) {
    throw new EngineError('INTERNAL_INVARIANT', 'Largest-remainder leftover out of range');
  }

  const ranked = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.row.pointsE4 !== b.row.pointsE4) return a.row.pointsE4 > b.row.pointsE4 ? -1 : 1;
    return compareStrings(a.row.employeeId, b.row.employeeId);
  });

  const shares = new Map<string, bigint>();
  for (const part of parts) shares.set(part.row.employeeId, part.base);
  let toAward = leftover;
  for (const part of ranked) {
    if (toAward === 0n) break;
    shares.set(part.row.employeeId, part.base + 1n);
    toAward -= 1n;
  }
  return shares;
}

export function computeDailyDistribution(input: DailyDistributionInput): DailyDistributionResult {
  assertIsoDate(input.date);
  const tips = convertTips(input.tips);
  const rows = parseRows(input.rows);
  const pendingAdvances = input.pendingAdvances ?? [];
  validatePendingAdvances(pendingAdvances);

  const tipsArsCents = tips
    .filter((t) => t.currency === 'ARS')
    .reduce((sum, t) => sum + t.amountCents, 0n);
  const tipsUsdCents = tips
    .filter((t) => t.currency === 'USD')
    .reduce((sum, t) => sum + t.amountCents, 0n);
  const totalCents = tips.reduce((sum, t) => sum + t.amountArsCents, 0n);
  const totalPointsE4 = rows.reduce((sum, r) => sum + r.pointsE4, 0n);

  const shares = splitByLargestRemainder(totalCents, rows, totalPointsE4);
  const percentScale = pow10(PERCENT_SCALE);

  const items: DailyItemResult[] = rows
    .map((row): DailyItemResult => {
      const grossCents = shares.get(row.employeeId) ?? 0n;
      const allocation: AdvanceAllocation = allocateAdvances({
        employeeId: row.employeeId,
        availableCents: grossCents,
        distributionDate: input.date,
        advances: pendingAdvances,
      });
      return {
        employeeId: row.employeeId,
        hoursE2: row.hoursE2,
        weightE2: row.weightE2,
        pointsE4: row.pointsE4,
        percentageE6: divRoundHalfUp(row.pointsE4 * percentScale, totalPointsE4),
        grossCents,
        advancesCents: allocation.appliedCents,
        finalCents: grossCents - allocation.appliedCents,
        applications: allocation.applications,
        pendingBalanceAfterCents: allocation.pendingBalanceAfterCents,
      };
    })
    .sort((a, b) => compareStrings(a.employeeId, b.employeeId));

  const appliedByAdvance = new Map<string, bigint>();
  for (const item of items) {
    for (const application of item.applications) {
      appliedByAdvance.set(
        application.advanceId,
        (appliedByAdvance.get(application.advanceId) ?? 0n) + application.cents,
      );
    }
  }
  const advanceUpdates: AdvanceUpdate[] = pendingAdvances
    .filter((advance) => appliedByAdvance.has(advance.advanceId))
    .map((advance) => {
      const appliedCents = appliedByAdvance.get(advance.advanceId) ?? 0n;
      return {
        advanceId: advance.advanceId,
        appliedCents,
        remainingAfterCents: advance.remainingCents - appliedCents,
      };
    })
    .sort((a, b) => compareStrings(a.advanceId, b.advanceId));

  const grossSum = items.reduce((sum, item) => sum + item.grossCents, 0n);
  if (grossSum !== totalCents) {
    throw new EngineError('INTERNAL_INVARIANT', 'Shares do not add up to the total pool');
  }

  return {
    date: input.date,
    tips,
    tipsArsCents,
    tipsUsdCents,
    totalCents,
    totalPointsE4,
    totalAdvancesCents: items.reduce((sum, item) => sum + item.advancesCents, 0n),
    totalFinalCents: items.reduce((sum, item) => sum + item.finalCents, 0n),
    items,
    advanceUpdates,
  };
}
