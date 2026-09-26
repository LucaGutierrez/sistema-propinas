import { parseDecimal, parseMoney } from '@/lib/decimal';
import {
  FACTOR_SCALE,
  HOURS_SCALE,
  ProvisionalFormulaError,
  computeProvisionalDistribution,
  type ProvisionalOptions,
  type ProvisionalResult,
} from './provisional-formula';

/** Una fila de la tabla de carga, tal como la escribe el usuario. */
export interface DistributionFormRow {
  id: string;
  name: string;
  hours: string;
  factor: string;
  advance: string;
}

export interface DistributionForm {
  total: string;
  rows: readonly DistributionFormRow[];
}

export type CalculationOutcome =
  { ok: true; result: ProvisionalResult } | { ok: false; errors: string[] };

/** Valida el formulario y calcula con la fórmula provisional. */
export function calculateFromForm(form: DistributionForm): CalculationOutcome {
  const totalCents = parseMoney(form.total);
  if (totalCents === null || totalCents <= 0n) {
    const rowErrors = calculateFromRows(1n, form.rows);
    return {
      ok: false,
      errors: [
        'Ingresá un total de propina válido, mayor que cero (por ejemplo 347.990).',
        ...(rowErrors.ok ? [] : rowErrors.errors),
      ],
    };
  }
  return calculateFromRows(totalCents, form.rows);
}

/** Igual que `calculateFromForm`, con el pozo ya en centavos (p. ej. la suma de la semana). */
export function calculateFromRows(
  totalCents: bigint,
  formRows: readonly DistributionFormRow[],
  options: ProvisionalOptions = {},
): CalculationOutcome {
  const errors: string[] = [];
  if (totalCents <= 0n) errors.push('El pozo de la semana tiene que ser mayor que cero.');

  const rows = formRows.map((row) => {
    const hoursE2 = row.hours.trim() === '' ? 0n : parseDecimal(row.hours, HOURS_SCALE);
    const factorE4 = parseDecimal(row.factor, FACTOR_SCALE);
    const advanceCents = row.advance.trim() === '' ? 0n : parseMoney(row.advance);
    if (hoursE2 === null) errors.push(`${row.name}: horas inválidas (hasta 2 decimales).`);
    if (factorE4 === null) errors.push(`${row.name}: factor inválido (hasta 4 decimales).`);
    if (advanceCents === null) errors.push(`${row.name}: adelanto inválido.`);
    return {
      id: row.id,
      hoursE2: hoursE2 ?? 0n,
      factorE4: factorE4 ?? 0n,
      advanceCents: advanceCents ?? 0n,
    };
  });

  if (errors.length > 0) return { ok: false, errors };
  try {
    return { ok: true, result: computeProvisionalDistribution(totalCents, rows, options) };
  } catch (error) {
    if (error instanceof ProvisionalFormulaError) return { ok: false, errors: [error.message] };
    throw error;
  }
}
