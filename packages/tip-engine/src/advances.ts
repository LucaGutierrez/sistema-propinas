import { EngineError } from './errors';
import type { AdvanceAllocation, AdvanceApplication, PendingAdvance } from './types';
import { assertIsoDate, type IsoDate } from './week';

/** Validates the whole set of pending advances once, before any allocation. */
export function validatePendingAdvances(advances: readonly PendingAdvance[]): void {
  const seen = new Set<string>();
  for (const advance of advances) {
    if (typeof advance.advanceId !== 'string' || advance.advanceId === '') {
      throw new EngineError('INVALID_ADVANCE', 'Advance id must be a non-empty string');
    }
    if (seen.has(advance.advanceId)) {
      throw new EngineError('DUPLICATE_ID', `Duplicate advance id: ${advance.advanceId}`);
    }
    seen.add(advance.advanceId);
    if (typeof advance.employeeId !== 'string' || advance.employeeId === '') {
      throw new EngineError('INVALID_ADVANCE', `Advance ${advance.advanceId} has no employee`);
    }
    assertIsoDate(advance.date);
    if (typeof advance.remainingCents !== 'bigint' || advance.remainingCents < 0n) {
      throw new EngineError(
        'INVALID_ADVANCE',
        `Advance ${advance.advanceId} must have a non-negative bigint balance`,
      );
    }
  }
}

function compareAdvances(a: PendingAdvance, b: PendingAdvance): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.advanceId !== b.advanceId) return a.advanceId < b.advanceId ? -1 : 1;
  return 0;
}

/**
 * Applies an employee's pending advances to the amount available on a given day.
 * Oldest advance first (ties by id). Advances dated after the day are not eligible.
 * Whatever does not fit stays as pending balance; the result is never negative.
 */
export function allocateAdvances(params: {
  employeeId: string;
  availableCents: bigint;
  distributionDate: IsoDate;
  advances: readonly PendingAdvance[];
}): AdvanceAllocation {
  const { employeeId, availableCents, distributionDate, advances } = params;
  if (typeof availableCents !== 'bigint' || availableCents < 0n) {
    throw new EngineError('INVALID_AMOUNT', 'Available amount must be a non-negative bigint');
  }
  assertIsoDate(distributionDate);

  const eligible = advances
    .filter(
      (a) => a.employeeId === employeeId && a.date <= distributionDate && a.remainingCents > 0n,
    )
    .sort(compareAdvances);

  let left = availableCents;
  let appliedCents = 0n;
  let eligibleBalance = 0n;
  const applications: AdvanceApplication[] = [];

  for (const advance of eligible) {
    eligibleBalance += advance.remainingCents;
    const cents = advance.remainingCents < left ? advance.remainingCents : left;
    if (cents > 0n) {
      applications.push({ advanceId: advance.advanceId, cents });
      left -= cents;
      appliedCents += cents;
    }
  }

  return {
    appliedCents,
    applications,
    pendingBalanceAfterCents: eligibleBalance - appliedCents,
  };
}
