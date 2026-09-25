import type { IsoDate } from './week';

/*
 * Naming convention: a suffix states the fixed-point scale of a bigint.
 *   ...Cents  -> money in centavos (scale 2)
 *   ...E2     -> hours / weights (scale 2)
 *   ...E4     -> points = hours x weight (scale 4)
 *   ...E6     -> percentages as a 0..1 fraction, and exchange rates (scale 6)
 */

export type Currency = 'ARS' | 'USD';

export interface TipInput {
  currency: Currency;
  /** Amount in the ORIGINAL currency, in cents. Must be > 0. */
  amountCents: bigint;
  /** Pesos per 1 USD as a decimal string ("1180.50"). Required for USD, forbidden for ARS. */
  rate?: string;
}

export interface WorkRow {
  employeeId: string;
  /** Decimal string, 0..24, at most 2 decimals. 0 means "did not work" (row ignored). */
  hours: string;
  /** Position weight as a decimal string, > 0, at most 2 decimals. */
  weight: string;
}

export interface PendingAdvance {
  advanceId: string;
  employeeId: string;
  date: IsoDate;
  /** Unapplied balance of the advance, in cents. */
  remainingCents: bigint;
}

export interface AdvanceApplication {
  advanceId: string;
  cents: bigint;
}

export interface AdvanceAllocation {
  appliedCents: bigint;
  applications: AdvanceApplication[];
  /** Eligible advance balance that did NOT fit in the available amount (saldo pendiente). */
  pendingBalanceAfterCents: bigint;
}

export interface AdvanceUpdate {
  advanceId: string;
  /** Cents applied by this distribution. */
  appliedCents: bigint;
  /** Balance left on the advance after this distribution. */
  remainingAfterCents: bigint;
}

export interface DailyDistributionInput {
  date: IsoDate;
  tips: readonly TipInput[];
  rows: readonly WorkRow[];
  pendingAdvances?: readonly PendingAdvance[];
}

export interface ConvertedTip {
  currency: Currency;
  amountCents: bigint;
  rateE6: bigint | null;
  amountArsCents: bigint;
}

export interface DailyItemResult {
  employeeId: string;
  hoursE2: bigint;
  weightE2: bigint;
  pointsE4: bigint;
  /** points / totalPoints, scale 6. Informational: amounts are never derived from it. */
  percentageE6: bigint;
  grossCents: bigint;
  advancesCents: bigint;
  finalCents: bigint;
  applications: AdvanceApplication[];
  pendingBalanceAfterCents: bigint;
}

export interface DailyDistributionResult {
  date: IsoDate;
  tips: ConvertedTip[];
  tipsArsCents: bigint;
  tipsUsdCents: bigint;
  /** Total tip pool in ARS (pesos + converted dollars). */
  totalCents: bigint;
  totalPointsE4: bigint;
  totalAdvancesCents: bigint;
  totalFinalCents: bigint;
  /** Sorted by employeeId. */
  items: DailyItemResult[];
  /** Sorted by advanceId. */
  advanceUpdates: AdvanceUpdate[];
}

export interface SettledItem {
  employeeId: string;
  grossCents: bigint;
  advancesCents: bigint;
  finalCents: bigint;
}

export interface SettledDay {
  date: IsoDate;
  distributionId: string;
  items: readonly SettledItem[];
}

export interface WeeklySettlementInput {
  weekStart: IsoDate;
  /** Closed daily distributions of the week (one per pool per day). */
  days: readonly SettledDay[];
}

export interface PaymentDayBreakdown {
  date: IsoDate;
  grossCents: bigint;
  advancesCents: bigint;
  finalCents: bigint;
}

export interface WeeklyPaymentResult {
  employeeId: string;
  grossCents: bigint;
  advancesCents: bigint;
  /** Amount that goes into the envelope. */
  netCents: bigint;
  perDay: PaymentDayBreakdown[];
}

export interface WeeklySettlementResult {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  /** Sorted by employeeId; only employees with gross > 0. */
  payments: WeeklyPaymentResult[];
  totals: { grossCents: bigint; advancesCents: bigint; netCents: bigint };
  distributionCount: number;
  /** Dates of the week with no distribution at all. */
  daysWithoutDistribution: IsoDate[];
}
