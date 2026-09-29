/**
 * Motor de participación de GUTIP: funciones PURAS (sin base, sin reloj, sin floats).
 *
 * Una sola fórmula de peso para los tres métodos de participación. El método decide si la porción
 * del puesto y los puntos individuales intervienen; el que no interviene vale 1:
 *
 *   ponderado = horas (E2) × F (E4) × P (E2)                         → escala fija E8
 *
 *     BY_POSITION               F = porción del puesto   P = 1,00
 *     BY_POINTS                 F = 1                    P = puntos del empleado
 *     BY_POSITION_TIMES_POINTS  F = porción del puesto   P = puntos del empleado
 *
 * Cada pozo se reparte por separado (`computePool`): participación = ponderado / Σ ponderado del
 * pozo, importe por mayor resto en la unidad de redondeo (la suma coincide exacto con el pozo).
 * Los adelantos son por persona y por período, NUNCA por pozo: se descuentan una vez sobre el bruto
 * total de la persona (`applyAdvances`) y ese descuento se reparte entre sus ítems en orden
 * (`spreadAdvances`), así ningún ítem descuenta más que su importe.
 *
 * Con BY_POSITION, P = 1,00 multiplica todos los pesos y el total por 100: bases, restos y su orden
 * no cambian, así que los importes son idénticos a `computeProvisionalDistribution` (probado).
 */
import { FACTOR_SCALE, HOURS_SCALE } from './provisional-formula';

export type ParticipationMethod = 'BY_POSITION' | 'BY_POINTS' | 'BY_POSITION_TIMES_POINTS';

export const PARTICIPATION_METHODS: readonly ParticipationMethod[] = [
  'BY_POSITION',
  'BY_POINTS',
  'BY_POSITION_TIMES_POINTS',
];

/** Puntos individuales del empleado: hasta 2 decimales ("1,20" → 120n). */
export const INDIVIDUAL_POINTS_SCALE = 2;
/** Escala del ponderado: horas E2 × porción E4 × puntos E2. */
export const WEIGHT_SCALE = HOURS_SCALE + FACTOR_SCALE + INDIVIDUAL_POINTS_SCALE;

const ONE_FACTOR = 10n ** BigInt(FACTOR_SCALE);
const ONE_POINT = 10n ** BigInt(INDIVIDUAL_POINTS_SCALE);

export class ParticipationError extends Error {}

/** Qué datos usa cada método. */
export function methodUses(method: ParticipationMethod): { factor: boolean; points: boolean } {
  switch (method) {
    case 'BY_POSITION':
      return { factor: true, points: false };
    case 'BY_POINTS':
      return { factor: false, points: true };
    case 'BY_POSITION_TIMES_POINTS':
      return { factor: true, points: true };
  }
}

export interface WeightInput {
  hoursE2: bigint;
  /** Porción del puesto (E4). Solo se lee si el método la usa. */
  factorE4: bigint | null;
  /** Puntos individuales (E2). Solo se leen si el método los usa. */
  pointsE2: bigint | null;
}

/** Ponderado (E8) de una persona en un pozo. */
export function participationWeight(input: WeightInput, method: ParticipationMethod): bigint {
  const uses = methodUses(method);
  if (input.hoursE2 < 0n) throw new ParticipationError('Las horas no pueden ser negativas.');
  let factor = ONE_FACTOR;
  if (uses.factor) {
    if (input.factorE4 === null || input.factorE4 <= 0n) {
      throw new ParticipationError('Falta la porción del puesto.');
    }
    factor = input.factorE4;
  }
  let points = ONE_POINT;
  if (uses.points) {
    if (input.pointsE2 === null || input.pointsE2 <= 0n) {
      throw new ParticipationError('Faltan los puntos de la persona.');
    }
    points = input.pointsE2;
  }
  return input.hoursE2 * factor * points;
}

// ─────────────────────────── Un pozo ───────────────────────────

export interface PoolRow {
  id: string;
  weightE8: bigint;
}

export interface PoolShare {
  id: string;
  weightE8: bigint;
  /** Participación en centésimas de punto porcentual (1167n → 11,67 %), redondeo half-up. */
  percentE2: bigint;
  /** Importe bruto (antes de adelantos). */
  amountCents: bigint;
}

export interface PoolResult {
  totalCents: bigint;
  totalWeightE8: bigint;
  /** En el mismo orden que las filas de entrada. */
  shares: PoolShare[];
}

/**
 * Reparte UN pozo por mayor resto en la unidad de redondeo (`unitCents`: 1 = centavo, 100 = peso).
 * Empates de resto: mayor ponderado, luego el orden de las filas. Mismos mensajes de error que la
 * fórmula provisional.
 */
export function computePool(
  totalCents: bigint,
  rows: readonly PoolRow[],
  options: { unitCents?: bigint } = {},
): PoolResult {
  if (totalCents <= 0n) {
    throw new ParticipationError('El total de propina debe ser mayor que cero.');
  }
  const unit = options.unitCents ?? 1n;
  if (unit <= 0n) throw new ParticipationError('La unidad de redondeo debe ser positiva.');
  if (totalCents % unit !== 0n) {
    throw new ParticipationError(
      'Con el redondeo configurado, el pozo tiene que ser un número entero de esa unidad (sin centavos sueltos).',
    );
  }
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new ParticipationError(`Empleado repetido: ${row.id}`);
    ids.add(row.id);
    if (row.weightE8 < 0n) throw new ParticipationError('El ponderado no puede ser negativo.');
  }
  const totalWeightE8 = rows.reduce((sum, row) => sum + row.weightE8, 0n);
  if (totalWeightE8 === 0n) {
    throw new ParticipationError('Nadie tiene ponderado para repartir: cargá las horas.');
  }

  const totalUnits = totalCents / unit;
  const parts = rows.map((row, index) => ({
    index,
    weight: row.weightE8,
    base: (totalUnits * row.weightE8) / totalWeightE8,
    remainder: (totalUnits * row.weightE8) % totalWeightE8,
  }));
  let leftover = totalUnits - parts.reduce((sum, part) => sum + part.base, 0n);
  const units = parts.map((part) => part.base);
  const ranked = parts
    .filter((part) => part.weight > 0n)
    .sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      if (a.weight !== b.weight) return a.weight > b.weight ? -1 : 1;
      return a.index - b.index;
    });
  for (const part of ranked) {
    if (leftover === 0n) break;
    units[part.index] = part.base + 1n;
    leftover -= 1n;
  }

  return {
    totalCents,
    totalWeightE8,
    shares: rows.map((row, index) => ({
      id: row.id,
      weightE8: row.weightE8,
      percentE2: (row.weightE8 * 10_000n * 2n + totalWeightE8) / (totalWeightE8 * 2n),
      amountCents: (units[index] ?? 0n) * unit,
    })),
  };
}

// ─────────────────────────── Adelantos ───────────────────────────

export interface AdvanceInput {
  id: string;
  /** Bruto de la persona en el período: Σ de sus importes en todos los pozos. */
  grossCents: bigint;
  /** Saldo pendiente de sus adelantos. */
  pendingCents: bigint;
}

export interface AdvanceResult {
  id: string;
  grossCents: bigint;
  /** Lo que se descuenta en este período: min(saldo, bruto). */
  appliedCents: bigint;
  /** Lo que queda pendiente para el próximo período. */
  remainingCents: bigint;
  finalCents: bigint;
}

/** Descuenta los adelantos UNA vez por persona, sobre su bruto total (nunca queda negativo). */
export function applyAdvances(people: readonly AdvanceInput[]): AdvanceResult[] {
  return people.map((person) => {
    if (person.grossCents < 0n || person.pendingCents < 0n) {
      throw new ParticipationError('Bruto y adelanto no pueden ser negativos.');
    }
    const appliedCents =
      person.pendingCents < person.grossCents ? person.pendingCents : person.grossCents;
    return {
      id: person.id,
      grossCents: person.grossCents,
      appliedCents,
      remainingCents: person.pendingCents - appliedCents,
      finalCents: person.grossCents - appliedCents,
    };
  });
}

export interface SpreadItem {
  key: string;
  amountCents: bigint;
}

export interface SpreadResult {
  key: string;
  amountCents: bigint;
  advanceCents: bigint;
  finalCents: bigint;
}

/**
 * Reparte el adelanto ya aplicado a una persona entre sus ítems, EN EL ORDEN RECIBIDO (el llamador
 * los ordena: día y luego orden del turno), llenando cada uno hasta su importe. Así se cumple
 * `0 ≤ adelanto ≤ importe` por ítem y la suma coincide con lo aplicado.
 */
export function spreadAdvances(items: readonly SpreadItem[], appliedCents: bigint): SpreadResult[] {
  if (appliedCents < 0n) throw new ParticipationError('El adelanto no puede ser negativo.');
  const available = items.reduce((sum, item) => sum + item.amountCents, 0n);
  if (items.some((item) => item.amountCents < 0n)) {
    throw new ParticipationError('Un importe no puede ser negativo.');
  }
  if (appliedCents > available) {
    throw new ParticipationError('El adelanto aplicado supera lo que la persona cobra.');
  }
  let remaining = appliedCents;
  return items.map((item) => {
    const advanceCents = remaining < item.amountCents ? remaining : item.amountCents;
    remaining -= advanceCents;
    return {
      key: item.key,
      amountCents: item.amountCents,
      advanceCents,
      finalCents: item.amountCents - advanceCents,
    };
  });
}
