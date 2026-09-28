/**
 * Lo que el servidor le pasa a la pantalla "Repartir propinas" (y al detalle de un reparto).
 * Sin bigint: los importes viajan como texto de centavos ("34799000") y se convierten con
 * `BigInt()` en el navegador, así el cálculo en vivo usa la misma aritmética exacta.
 */
import { formatScaled, parseDecimal } from '@/lib/decimal';
import { HOURS_SCALE } from './provisional-formula';

/** Nota de la propina cargada como total del período (una sola fila en `tip_entries`). */
export const PERIOD_TOTAL_NOTE = 'Total del período';

export type TipsMode = 'total' | 'daily';

export interface PeriodPersonView {
  employeeId: string;
  name: string;
  positionId: string | null;
  positionName: string | null;
  factor: string | null;
  /** Horas cargadas ("45", "7,5"); null = sin cargar. */
  hours: string | null;
  /** Adelantos pendientes que se descuentan en este reparto (centavos). */
  advanceCents: string;
  active: boolean;
}

export interface PeriodAdvanceView {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  amountCents: string;
  /** Lo que queda por descontar (centavos). */
  balanceCents: string;
  note: string | null;
  createdByName: string;
  /** Es de antes de este período (saldo que quedó pendiente). */
  carried: boolean;
}

export interface OpenPeriodView {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  policyVersion: number;
  roundingUnit: 'CENT' | 'PESO';
  /** 1 (centavos) o 100 (pesos enteros). */
  unitCents: string;
  tips: {
    mode: TipsMode;
    totalCents: string;
    days: { date: string; amountCents: string }[];
  };
  people: PeriodPersonView[];
  advances: PeriodAdvanceView[];
  canEdit: boolean;
  canClose: boolean;
}

export interface ClosedPeriodRow {
  employeeId: string;
  name: string;
  positionName: string;
  hours: string;
  factor: string;
  pointsE6: string;
  percentE2: string;
  amountCents: string;
  advancesCents: string;
  finalCents: string;
  paymentStatus: 'PENDING' | 'PREPARED' | 'DELIVERED' | 'VOIDED' | null;
}

export interface ClosedPeriodView {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  status: 'CLOSED' | 'VOIDED';
  closedAt: string | null;
  closedByName: string | null;
  policyVersion: number;
  roundingUnit: 'CENT' | 'PESO';
  totalCents: string;
  totalAdvancesCents: string;
  totalFinalCents: string;
  totalPointsE6: string;
  totalHours: string;
  tipsByDay: { date: string; amountCents: string }[];
  tipsMode: TipsMode;
  rows: ClosedPeriodRow[];
  /** Personas del período que no trabajaron (0 horas): no reciben propina. */
  withoutHours: string[];
}

export interface PeriodListItem {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  status: 'OPEN' | 'CLOSED';
  totalCents: string | null;
  totalFinalCents: string | null;
  closedAt: string | null;
}

/** "45.00" (NUMERIC de la base) → "45"; "7.50" → "7,5". */
export function hoursText(dbValue: string): string {
  const scaled = parseDecimal(dbValue, HOURS_SCALE);
  if (scaled === null) return dbValue;
  return formatScaled(scaled, HOURS_SCALE, HOURS_SCALE)
    .replace(/\./g, '')
    .replace(/,?0+$/, '')
    .replace(/,$/, '');
}

/** Centésimas de hora → "45" / "7,5" / "301". */
export function formatHoursE2(hoursE2: bigint): string {
  return formatScaled(hoursE2, HOURS_SCALE, HOURS_SCALE).replace(/,?0+$/, '').replace(/,$/, '');
}
