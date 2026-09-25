import { expect } from 'vitest';
import {
  EngineError,
  type AdvanceUpdate,
  type DailyDistributionResult,
  type DailyItemResult,
  type EngineErrorCode,
  type PendingAdvance,
  type TipInput,
  type WorkRow,
} from '../src';

export const DAY = '2026-09-24';

/** Asserts that `fn` throws an EngineError with exactly this code. */
export function expectCode(fn: () => unknown, code: EngineErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return;
  }
  expect.fail(`Expected EngineError ${code}, but nothing was thrown`);
}

export const ars = (amountCents: bigint): TipInput => ({ currency: 'ARS', amountCents });
export const usd = (amountCents: bigint, rate: string): TipInput => ({
  currency: 'USD',
  amountCents,
  rate,
});
export const row = (employeeId: string, hours: string, weight = '1.00'): WorkRow => ({
  employeeId,
  hours,
  weight,
});

export function itemOf(result: DailyDistributionResult, employeeId: string): DailyItemResult {
  const found = result.items.find((item) => item.employeeId === employeeId);
  if (!found) throw new Error(`No item for employee ${employeeId}`);
  return found;
}

/** Turns the advance updates of a closed day into the pending list for the next day. */
export function nextPending(
  previous: readonly PendingAdvance[],
  updates: readonly AdvanceUpdate[],
): PendingAdvance[] {
  return previous
    .map((advance) => {
      const update = updates.find((u) => u.advanceId === advance.advanceId);
      return update ? { ...advance, remainingCents: update.remainingAfterCents } : advance;
    })
    .filter((advance) => advance.remainingCents > 0n);
}

/** Deterministic Fisher-Yates permutation driven by an integer seed (xorshift32). */
export function permute<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed | 0 || 0x9e3779b9;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}
