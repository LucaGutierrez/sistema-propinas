/**
 * FÓRMULA PROVISIONAL de la vista de distribución.
 *
 * No es el contrato definitivo: la fórmula histórica exacta de la planilla todavía se está
 * validando (PROGRESS.md, pendiente A4). Por eso vive en la aplicación y NO en
 * `packages/tip-engine`, cuyo contrato no se modifica hasta cerrar esa validación.
 *
 *   puntos     = horas × factor
 *   porcentaje = puntos / total de puntos
 *   importe    = pozo × porcentaje   (reparto por mayor resto: la suma coincide con el pozo)
 *   final      = importe − adelanto  (el adelanto que no entra queda como saldo pendiente)
 *
 * Diferencias conocidas con el motor: las horas son las ACUMULADAS DE LA SEMANA (sin límite
 * de 24) y el factor admite hasta 4 decimales. Aritmética exacta con bigint, sin floats.
 *
 * La unidad de redondeo es configuración de cada restaurante (`unitCents`: 1 = centavo,
 * 100 = peso). El reparto se hace por mayor resto EN ESA UNIDAD, así que la suma coincide
 * siempre con el pozo; por eso el pozo tiene que ser múltiplo de la unidad.
 */
export const FORMULA_STATUS = 'PROVISIONAL' as const;

export const HOURS_SCALE = 2;
export const FACTOR_SCALE = 4;
/** puntos = horas (E2) × factor (E4). */
export const POINTS_SCALE = HOURS_SCALE + FACTOR_SCALE;
/** Porcentaje en centésimas de punto porcentual: 1167n → 11,67 %. */
export const PERCENT_SCALE = 2;

export interface ProvisionalRow {
  id: string;
  hoursE2: bigint;
  factorE4: bigint;
  advanceCents: bigint;
}

export interface ProvisionalItem {
  id: string;
  hoursE2: bigint;
  factorE4: bigint;
  pointsE6: bigint;
  percentE2: bigint;
  amountCents: bigint;
  advanceAppliedCents: bigint;
  pendingAdvanceCents: bigint;
  finalCents: bigint;
}

export interface ProvisionalResult {
  status: typeof FORMULA_STATUS;
  totalCents: bigint;
  totalPointsE6: bigint;
  totalAdvanceCents: bigint;
  totalFinalCents: bigint;
  /** En el mismo orden que las filas de entrada. */
  items: ProvisionalItem[];
}

export class ProvisionalFormulaError extends Error {}

export interface ProvisionalOptions {
  /** Unidad de reparto en centavos: 1n = centavo (por defecto), 100n = peso. */
  unitCents?: bigint;
}

export function computeProvisionalDistribution(
  totalCents: bigint,
  rows: readonly ProvisionalRow[],
  options: ProvisionalOptions = {},
): ProvisionalResult {
  if (totalCents <= 0n) {
    throw new ProvisionalFormulaError('El total de propina debe ser mayor que cero.');
  }
  const unit = options.unitCents ?? 1n;
  if (unit <= 0n) throw new ProvisionalFormulaError('La unidad de redondeo debe ser positiva.');
  if (totalCents % unit !== 0n) {
    throw new ProvisionalFormulaError(
      'Con el redondeo configurado, el pozo tiene que ser un número entero de esa unidad (sin centavos sueltos).',
    );
  }
  const totalUnits = totalCents / unit;
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new ProvisionalFormulaError(`Empleado repetido: ${row.id}`);
    ids.add(row.id);
    if (row.hoursE2 < 0n || row.factorE4 < 0n || row.advanceCents < 0n) {
      throw new ProvisionalFormulaError('Horas, porción y adelanto no pueden ser negativos.');
    }
  }

  const points = rows.map((row) => row.hoursE2 * row.factorE4);
  const totalPointsE6 = points.reduce((sum, p) => sum + p, 0n);
  if (totalPointsE6 === 0n) {
    throw new ProvisionalFormulaError('Nadie tiene puntos: cargá horas y porción.');
  }

  // Mayor resto en la unidad configurada; empates: más puntos, luego el orden de la tabla.
  const parts = points.map((p, index) => ({
    index,
    points: p,
    base: (totalUnits * p) / totalPointsE6,
    remainder: (totalUnits * p) % totalPointsE6,
  }));
  let leftover = totalUnits - parts.reduce((sum, part) => sum + part.base, 0n);
  const amounts = parts.map((part) => part.base);
  const ranked = parts
    .filter((part) => part.points > 0n)
    .sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      if (a.points !== b.points) return a.points > b.points ? -1 : 1;
      return a.index - b.index;
    });
  for (const part of ranked) {
    if (leftover === 0n) break;
    amounts[part.index] = part.base + 1n;
    leftover -= 1n;
  }

  const items = rows.map((row, index): ProvisionalItem => {
    const pointsE6 = points[index] ?? 0n;
    const amountCents = (amounts[index] ?? 0n) * unit;
    const advanceAppliedCents = row.advanceCents < amountCents ? row.advanceCents : amountCents;
    return {
      id: row.id,
      hoursE2: row.hoursE2,
      factorE4: row.factorE4,
      pointsE6,
      percentE2: (pointsE6 * 10_000n * 2n + totalPointsE6) / (totalPointsE6 * 2n),
      amountCents,
      advanceAppliedCents,
      pendingAdvanceCents: row.advanceCents - advanceAppliedCents,
      finalCents: amountCents - advanceAppliedCents,
    };
  });

  return {
    status: FORMULA_STATUS,
    totalCents,
    totalPointsE6,
    totalAdvanceCents: items.reduce((sum, item) => sum + item.advanceAppliedCents, 0n),
    totalFinalCents: items.reduce((sum, item) => sum + item.finalCents, 0n),
    items,
  };
}
