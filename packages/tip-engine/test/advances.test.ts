import { describe, expect, it } from 'vitest';
import { allocateAdvances, validatePendingAdvances, type PendingAdvance } from '../src';
import { DAY, expectCode } from './helpers';

const adv = (
  advanceId: string,
  remainingCents: bigint,
  date = '2026-09-20',
  employeeId = 'roro',
): PendingAdvance => ({ advanceId, employeeId, date, remainingCents });

const allocate = (availableCents: bigint, advances: PendingAdvance[], employeeId = 'roro') =>
  allocateAdvances({ employeeId, availableCents, distributionDate: DAY, advances });

describe('allocateAdvances', () => {
  it('advance bigger than the available amount: applies what fits, keeps the balance', () => {
    // Tip $30.000, advance $40.000 -> day $0, pending balance $10.000
    const result = allocate(3_000_000n, [adv('a1', 4_000_000n)]);
    expect(result.appliedCents).toBe(3_000_000n);
    expect(result.applications).toEqual([{ advanceId: 'a1', cents: 3_000_000n }]);
    expect(result.pendingBalanceAfterCents).toBe(1_000_000n);
  });

  it('advance smaller than the available amount is fully applied', () => {
    const result = allocate(5_000_000n, [adv('a1', 1_000_000n)]);
    expect(result.appliedCents).toBe(1_000_000n);
    expect(result.pendingBalanceAfterCents).toBe(0n);
  });

  it('advance exactly equal to the available amount leaves nothing pending', () => {
    const result = allocate(1_000_000n, [adv('a1', 1_000_000n)]);
    expect(result.appliedCents).toBe(1_000_000n);
    expect(result.pendingBalanceAfterCents).toBe(0n);
  });

  it('applies the oldest advance first, regardless of input order', () => {
    // 1_000_000 available: a1 (older, 800_000) fully, then a2 (500_000) gets 200_000.
    const result = allocate(1_000_000n, [
      adv('a2', 500_000n, '2026-09-02'),
      adv('a1', 800_000n, '2026-09-01'),
    ]);
    expect(result.applications).toEqual([
      { advanceId: 'a1', cents: 800_000n },
      { advanceId: 'a2', cents: 200_000n },
    ]);
    expect(result.appliedCents).toBe(1_000_000n);
    expect(result.pendingBalanceAfterCents).toBe(300_000n);
  });

  it('breaks date ties by advance id', () => {
    const result = allocate(100n, [adv('b', 100n, '2026-09-01'), adv('a', 100n, '2026-09-01')]);
    expect(result.applications).toEqual([{ advanceId: 'a', cents: 100n }]);
    expect(result.pendingBalanceAfterCents).toBe(100n);
  });

  it('ignores advances dated after the distribution day', () => {
    const result = allocate(1_000_000n, [adv('future', 500_000n, '2026-09-25')]);
    expect(result.appliedCents).toBe(0n);
    expect(result.applications).toEqual([]);
    expect(result.pendingBalanceAfterCents).toBe(0n);
  });

  it('applies an advance dated on the distribution day itself', () => {
    const result = allocate(1_000_000n, [adv('same-day', 500_000n, DAY)]);
    expect(result.appliedCents).toBe(500_000n);
  });

  it("ignores other employees' advances and exhausted advances", () => {
    const result = allocate(1_000_000n, [
      adv('other', 500_000n, '2026-09-20', 'leo'),
      adv('empty', 0n),
    ]);
    expect(result.appliedCents).toBe(0n);
    expect(result.applications).toEqual([]);
  });

  it('with nothing available, applies nothing and the whole balance stays pending', () => {
    const result = allocate(0n, [adv('a1', 700_000n), adv('a2', 300_000n, '2026-09-21')]);
    expect(result.appliedCents).toBe(0n);
    expect(result.applications).toEqual([]);
    expect(result.pendingBalanceAfterCents).toBe(1_000_000n);
  });

  it('never returns a negative amount', () => {
    const result = allocate(1n, [adv('a1', 10n ** 15n)]);
    expect(result.appliedCents).toBe(1n);
    expect(result.pendingBalanceAfterCents).toBe(10n ** 15n - 1n);
  });

  it('does not mutate its input', () => {
    const advances = Object.freeze([adv('a2', 5n, '2026-09-02'), adv('a1', 5n, '2026-09-01')]);
    expect(() => allocate(7n, advances as PendingAdvance[])).not.toThrow();
    expect(advances.map((a) => a.advanceId)).toEqual(['a2', 'a1']);
  });

  it('rejects invalid available amounts', () => {
    expectCode(() => allocate(-1n, []), 'INVALID_AMOUNT');
    expectCode(() => allocate(5 as unknown as bigint, []), 'INVALID_AMOUNT');
  });
});

describe('validatePendingAdvances', () => {
  it('accepts a valid list', () => {
    expect(() => validatePendingAdvances([adv('a1', 10n), adv('a2', 0n)])).not.toThrow();
  });

  it('rejects duplicate ids', () => {
    expectCode(() => validatePendingAdvances([adv('a1', 10n), adv('a1', 20n)]), 'DUPLICATE_ID');
  });

  it('rejects negative or non-bigint balances', () => {
    expectCode(() => validatePendingAdvances([adv('a1', -1n)]), 'INVALID_ADVANCE');
    expectCode(
      () => validatePendingAdvances([adv('a1', 10 as unknown as bigint)]),
      'INVALID_ADVANCE',
    );
  });

  it('rejects missing ids, missing employees and bad dates', () => {
    expectCode(() => validatePendingAdvances([adv('', 10n)]), 'INVALID_ADVANCE');
    expectCode(
      () => validatePendingAdvances([adv('a1', 10n, '2026-09-20', '')]),
      'INVALID_ADVANCE',
    );
    expectCode(() => validatePendingAdvances([adv('a1', 10n, '2026-02-30')]), 'INVALID_DATE');
  });
});
