/**
 * Reparto por sectores, FORMATO ANTERIOR (repartos cerrados antes del 2026-10-05): cada puesto era
 * un sector con una etapa y un porcentaje; la etapa 1 sobre el total y las siguientes sobre el
 * saldo de la anterior. Hoy el cálculo es `sector-steps.ts`; acá quedan los porcentajes (que usan
 * los dos formatos) y lo necesario para MOSTRAR esos repartos viejos desde su snapshot.
 */
import { formatScaled, parseDecimal } from '@/lib/decimal';

/** Porcentajes de sector: hasta 2 decimales ("12,5" → 1250n). */
export const STAGE_PERCENT_SCALE = 2;
const HUNDRED_E2 = 100n * 10n ** BigInt(STAGE_PERCENT_SCALE);

export type StageBase = 'TOTAL' | 'REMAINDER';

/** Porcentaje escrito → E2; null si no es un número mayor que 0 y hasta 100 (2 decimales). */
export function parseStagePercent(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null;
  const value = parseDecimal(text.replace(/%\s*$/, ''), STAGE_PERCENT_SCALE);
  return value !== null && value > 0n && value <= HUNDRED_E2 ? value : null;
}

/** E2 → "30" / "12,5" / "33,33" (sin ceros de más). */
export function formatStagePercent(percentE2: bigint): string {
  return formatScaled(percentE2, STAGE_PERCENT_SCALE, STAGE_PERCENT_SCALE)
    .replace(/,?0+$/, '')
    .replace(/,$/, '');
}

/** "sobre el total" / "sobre el saldo restante". */
export function stageBaseLabel(base: StageBase): string {
  return base === 'TOTAL' ? 'sobre el total' : 'sobre el saldo restante';
}

/** Plata que la última etapa dejó sin asignar (0 si la última sumó 100 %). */
export function unassignedCents(stages: readonly { remainderCents: bigint | string }[]): bigint {
  const last = stages[stages.length - 1];
  return last ? BigInt(last.remainderCents) : 0n;
}
