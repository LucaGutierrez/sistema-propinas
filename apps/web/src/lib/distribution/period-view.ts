/**
 * Lo que el servidor le pasa a la pantalla "Repartir propinas" (y al detalle de un reparto).
 * Sin bigint: los importes viajan como texto de centavos ("34799000") y se convierten con
 * `BigInt()` en el navegador, así el cálculo en vivo usa la misma aritmética exacta.
 */
import { formatScaled, parseDecimal } from '@/lib/decimal';
import { formatPortion, type PortionDisplay } from '@/lib/policy/portion-format';
import { WEIGHT_SCALE, type ParticipationMethod } from './participation';
import { HOURS_SCALE } from './provisional-formula';
import type { SectorStageView } from './sector-snapshot';
import type { SectorAssignment } from './sector-stages';

/** Nota de la propina cargada como total del período (una sola fila en `tip_entries`). */
export const PERIOD_TOTAL_NOTE = 'Total del período';

export type TipsMode = 'total' | 'daily';

export interface PeriodPersonView {
  employeeId: string;
  name: string;
  positionId: string | null;
  positionName: string | null;
  factor: string | null;
  /** Puntos individuales actuales de la persona ("1,20"). */
  individualPoints: string | null;
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
  /** Método de participación de la versión del período. */
  method: ParticipationMethod;
  /** Reparto por sectores (etapa y % de cada puesto); null = pozo único. */
  sectors: SectorAssignment[] | null;
  /** Cómo se muestran las porciones (preferencia del restaurante). */
  portionDisplay: PortionDisplay;
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
  /** Porción usada (del snapshot); null si el método no la usó. */
  factor: string | null;
  /** Puntos individuales usados (del snapshot); null si el método no los usó. */
  individualPoints: string | null;
  /** Ponderado exacto (E8) del snapshot. */
  weightE8: string;
  /** Ponderado en la escala anterior (E6, redondeado): se conserva por compatibilidad. */
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
  /** Método de participación con el que se calculó (la versión no cambia nunca). */
  method: ParticipationMethod;
  /** Reparto por sectores guardado al cerrar (snapshot); null = pozo único. */
  sectorStages: SectorStageView[] | null;
  portionDisplay: PortionDisplay;
  totalCents: string;
  totalAdvancesCents: string;
  totalFinalCents: string;
  totalPointsE6: string;
  /** Σ ponderado exacto (E8). */
  totalWeightE8: string;
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

/** Nombre de cada método de participación, con su cuenta. */
export const METHOD_LABEL: Record<ParticipationMethod, string> = {
  BY_POSITION: 'Por puesto (horas × porción)',
  BY_POINTS: 'Por puntos individuales (horas × puntos)',
  BY_POSITION_TIMES_POINTS: 'Puesto × puntos (horas × porción × puntos)',
};

/**
 * Lo que entra en el ponderado de una persona: "40 h × 2,2 % de porción × 1,20 puntos". La porción
 * y los puntos van solo si el método los usó (null = no intervinieron).
 */
export function weightInputsText(
  row: { hours: string; factor: string | null; individualPoints: string | null },
  display: PortionDisplay,
): string {
  return [
    `${row.hours} h`,
    row.factor !== null ? `${formatPortion(row.factor, display)} de porción` : null,
    row.individualPoints !== null ? `${row.individualPoints} puntos` : null,
  ]
    .filter((part) => part !== null)
    .join(' × ');
}

/** Ponderado (E8) → "0,63" / "48" / "1,056" (hasta 4 decimales, sin ceros de más). */
export function formatWeight(weightE8: bigint): string {
  return formatScaled(weightE8, WEIGHT_SCALE, 4).replace(/,?0+$/, '').replace(/,$/, '');
}
