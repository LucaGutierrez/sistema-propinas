/**
 * Reparto de un período con POZO ÚNICO (pantalla "Repartir propinas" y cierre en el servidor).
 *
 * Toma lo que cargó el usuario —propina del período, horas de cada persona y adelantos
 * pendientes— y arma el resultado con el motor de participación (`participation.ts`): un solo pozo,
 * con el método de la política. Por defecto BY_POSITION, que da exactamente los mismos importes que
 * la fórmula anterior (`computeProvisionalDistribution`, probado en los tests). La pantalla la usa
 * para mostrar el resultado en vivo y el servidor la vuelve a ejecutar con los datos de la base al
 * cerrar: los dos llegan a los mismos importes porque es la misma función con los mismos datos.
 *
 * Además de calcular, decide si el reparto se puede cerrar. Una persona activa SIN horas cargadas
 * nunca se reparte en silencio entre las demás: queda marcada "Sin horas cargadas" y bloquea el
 * cierre hasta que se cargue su número (0 si no trabajó).
 */
import { divRoundHalfUp, parseDecimal } from '@/lib/decimal';
import {
  applyAdvances,
  computePool,
  INDIVIDUAL_POINTS_SCALE,
  methodUses,
  ParticipationError,
  participationWeight,
  WEIGHT_SCALE,
  type ParticipationMethod,
} from './participation';
import { FACTOR_SCALE, HOURS_SCALE } from './provisional-formula';

/** Horas de un período semanal: nadie puede tener más de 24 × 7 (la base aplica el mismo tope). */
export const MAX_PERIOD_HOURS = 168;
const MAX_PERIOD_HOURS_E2 = BigInt(MAX_PERIOD_HOURS) * 10n ** BigInt(HOURS_SCALE);
/** 1,00 de ponderado en su escala (E8). */
const ONE_WEIGHT = 10n ** BigInt(WEIGHT_SCALE);
/** Ponderado E8 → escala anterior de los "puntos" (E6). */
const WEIGHT_TO_E6 = 10n ** BigInt(WEIGHT_SCALE - 6);

/** Una persona del reparto, tal como la conoce la pantalla. */
export interface PreviewPerson {
  employeeId: string;
  name: string;
  /** Puesto (`positions.id`) con el que se calcula; null si no tiene uno en la configuración. */
  positionId: string | null;
  /** Puesto de la persona (null si no tiene uno en la configuración del período). */
  positionName: string | null;
  /** Porción del puesto en la versión de la política del período ("0,014"); null sin puesto. */
  factor: string | null;
  /** Puntos individuales ("1,20"). Solo intervienen si el método los usa. */
  individualPoints?: string | null;
  /** Horas escritas ("45", "7,5"). null = todavía no se cargaron. */
  hours: string | null;
  /** Adelantos pendientes que se descuentan en este reparto (centavos). */
  advanceCents: bigint;
  /** false: dada de baja (solo aparece si ya tenía horas cargadas en este período). */
  active: boolean;
}

/** missing: sin horas cargadas · invalid: número inválido · zero: 0 h · worked: trabajó. */
export type PersonState = 'missing' | 'invalid' | 'zero' | 'worked';

export interface PreviewRow {
  employeeId: string;
  name: string;
  positionId: string | null;
  positionName: string | null;
  factor: string | null;
  active: boolean;
  state: PersonState;
  hoursE2: bigint | null;
  factorE4: bigint | null;
  individualPoints: string | null;
  /** Puntos individuales (E2); null si no se cargaron o no son válidos. */
  pointsE2: bigint | null;
  /** Ponderado (E8) = horas × porción × puntos, según el método. */
  weightE8: bigint;
  /**
   * Ponderado en la escala anterior (E6 = E8 ÷ 100). Exacto con BY_POSITION (puntos = 1,00), el
   * único método que usa producción hoy; lo sigue leyendo el cierre hasta la Fase 2.
   */
  pointsE6: bigint;
  /** Centésimas de punto porcentual (1167n → 11,67 %). */
  percentE2: bigint;
  /** Le corresponde (antes de adelantos). */
  amountCents: bigint;
  /** Adelanto que se descuenta en este reparto. */
  advanceAppliedCents: bigint;
  /** Adelanto que queda pendiente para el próximo reparto. */
  pendingAdvanceCents: bigint;
  /** A entregar. */
  finalCents: bigint;
}

export type PreviewIssueCode =
  | 'NO_PEOPLE'
  | 'NO_TIPS'
  | 'INVALID_HOURS'
  | 'MISSING_HOURS'
  | 'NO_POSITION'
  | 'NO_POINTS'
  | 'NO_HOURS'
  | 'ROUNDING';

export interface PreviewIssue {
  code: PreviewIssueCode;
  message: string;
  employeeIds: string[];
}

export interface HourValue {
  positionName: string;
  factor: string;
  /** Cuánto vale una hora de ese puesto en este reparto (centavos, redondeado). */
  centsPerHour: bigint;
}

export interface PeriodPreview {
  rows: PreviewRow[];
  /** Lo que falta o está mal. Cualquier problema bloquea el cierre. */
  issues: PreviewIssue[];
  /** Hay importes calculados (puede haberlos aunque falten datos, como vista previa). */
  computed: boolean;
  canClose: boolean;
  method: ParticipationMethod;
  totalCents: bigint;
  totalHoursE2: bigint;
  /** Σ ponderado (E8). */
  totalWeightE8: bigint;
  /** Σ ponderado en la escala anterior (E6). */
  totalPointsE6: bigint;
  totalAdvanceCents: bigint;
  totalFinalCents: bigint;
  /** Valor de 1,00 de ponderado en centavos (null sin cálculo). */
  pointValueCents: bigint | null;
  /**
   * Valor de la hora de cada puesto con horas (la explicación simple del cálculo). Solo con
   * BY_POSITION: con puntos individuales, la hora vale distinto para cada persona.
   */
  hourValues: HourValue[];
}

/** Horas escritas → centésimas de hora; null si el número no es válido o supera el período. */
export function parseHours(text: string): bigint | null {
  const hoursE2 = parseDecimal(text, HOURS_SCALE);
  if (hoursE2 === null || hoursE2 > MAX_PERIOD_HOURS_E2) return null;
  return hoursE2;
}

/** Puntos individuales escritos ("1,20") → E2; null si no es un número válido mayor que cero. */
export function parseIndividualPoints(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null;
  const pointsE2 = parseDecimal(text, INDIVIDUAL_POINTS_SCALE);
  return pointsE2 !== null && pointsE2 > 0n ? pointsE2 : null;
}

export function names(rows: readonly { name: string }[]): string {
  const list = rows.map((r) => r.name);
  if (list.length <= 3) return list.join(', ');
  return `${list.slice(0, 3).join(', ')} y ${list.length - 3} más`;
}

function issue(code: PreviewIssueCode, message: string, rows: readonly PreviewRow[] = []) {
  return { code, message, employeeIds: rows.map((r) => r.employeeId) };
}

export function buildPeriodPreview(input: {
  totalCents: bigint;
  /** Unidad del redondeo de la política: 1n = centavo, 100n = peso. */
  unitCents: bigint;
  /** Método de participación de la política (por defecto BY_POSITION, el de hoy). */
  method?: ParticipationMethod;
  people: readonly PreviewPerson[];
}): PeriodPreview {
  const method = input.method ?? 'BY_POSITION';
  const uses = methodUses(method);
  const rows: PreviewRow[] = input.people.map((person) => {
    const hoursE2 = person.hours === null ? null : parseHours(person.hours);
    const factorE4 = person.factor === null ? null : parseDecimal(person.factor, FACTOR_SCALE);
    const individualPoints = person.individualPoints ?? null;
    const state: PersonState =
      person.hours === null || person.hours.trim() === ''
        ? 'missing'
        : hoursE2 === null
          ? 'invalid'
          : hoursE2 === 0n
            ? 'zero'
            : 'worked';
    return {
      employeeId: person.employeeId,
      name: person.name,
      positionId: person.positionId,
      positionName: person.positionName,
      factor: person.factor,
      active: person.active,
      state,
      hoursE2: state === 'missing' || state === 'invalid' ? null : hoursE2,
      factorE4,
      individualPoints,
      pointsE2: parseIndividualPoints(individualPoints),
      weightE8: 0n,
      pointsE6: 0n,
      percentE2: 0n,
      amountCents: 0n,
      advanceAppliedCents: 0n,
      pendingAdvanceCents: person.advanceCents,
      finalCents: 0n,
    };
  });

  const issues: PreviewIssue[] = [];
  if (rows.length === 0) {
    issues.push(issue('NO_PEOPLE', 'Todavía no hay personal: agregá a tu equipo para repartir.'));
  }
  if (input.totalCents <= 0n) {
    issues.push(issue('NO_TIPS', 'Cargá la propina a repartir.'));
  }
  const invalid = rows.filter((r) => r.state === 'invalid');
  if (invalid.length > 0) {
    issues.push(
      issue(
        'INVALID_HOURS',
        `Revisá las horas de ${names(invalid)}: tiene que ser un número entre 0 y ${MAX_PERIOD_HOURS}.`,
        invalid,
      ),
    );
  }
  const missing = rows.filter((r) => r.state === 'missing' && r.active);
  if (missing.length > 0) {
    issues.push(
      issue(
        'MISSING_HOURS',
        missing.length === 1
          ? `Falta cargar las horas de ${names(missing)}. Si no trabajó, poné 0.`
          : `Faltan las horas de ${missing.length} personas (${names(missing)}). Si alguien no trabajó, poné 0.`,
        missing,
      ),
    );
  }
  const worked = rows.filter((r) => r.state === 'worked');
  // Todo ítem necesita su puesto (queda en el snapshot del cierre), aunque el método no use la
  // porción; la porción solo se exige si el método la usa.
  const hasFactor = (r: PreviewRow) =>
    r.positionId !== null && (!uses.factor || (r.factorE4 !== null && r.factorE4 > 0n));
  const hasPoints = (r: PreviewRow) => !uses.points || r.pointsE2 !== null;
  const noPosition = worked.filter((r) => !hasFactor(r));
  if (noPosition.length > 0) {
    issues.push(
      issue(
        'NO_POSITION',
        `${names(noPosition)} no tiene un puesto de la configuración: asignale uno en Personal.`,
        noPosition,
      ),
    );
  }
  const noPoints = worked.filter((r) => !hasPoints(r));
  if (noPoints.length > 0) {
    issues.push(
      issue(
        'NO_POINTS',
        `${names(noPoints)} no tiene puntos válidos: cargalos en Personal.`,
        noPoints,
      ),
    );
  }
  const participants = worked.filter((r) => hasFactor(r) && hasPoints(r));
  // "Nadie trabajó" solo cuando ya se cargó todo (si faltan horas, ya lo dice MISSING_HOURS).
  if (
    rows.length > 0 &&
    participants.length === 0 &&
    invalid.length === 0 &&
    missing.length === 0
  ) {
    issues.push(issue('NO_HOURS', 'Nadie tiene horas trabajadas: cargá las horas para repartir.'));
  }

  let computed = false;
  let totalWeightE8 = 0n;
  let totalAdvanceCents = 0n;
  let totalFinalCents = 0n;
  let pointValueCents: bigint | null = null;
  const hourValues: HourValue[] = [];

  if (input.totalCents > 0n && participants.length > 0) {
    try {
      const weights = participants.map((r) =>
        participationWeight(
          { hoursE2: r.hoursE2 ?? 0n, factorE4: r.factorE4, pointsE2: r.pointsE2 },
          method,
        ),
      );
      const pool = computePool(
        input.totalCents,
        participants.map((r, index) => ({ id: r.employeeId, weightE8: weights[index] ?? 0n })),
        { unitCents: input.unitCents },
      );
      // Un solo pozo: el bruto de cada persona es su importe en este pozo.
      const advances = applyAdvances(
        participants.map((r, index) => ({
          id: r.employeeId,
          grossCents: pool.shares[index]?.amountCents ?? 0n,
          pendingCents: r.pendingAdvanceCents,
        })),
      );
      participants.forEach((row, index) => {
        const share = pool.shares[index];
        const advance = advances[index];
        if (!share || !advance) return;
        row.weightE8 = share.weightE8;
        row.pointsE6 = share.weightE8 / WEIGHT_TO_E6;
        row.percentE2 = share.percentE2;
        row.amountCents = share.amountCents;
        row.advanceAppliedCents = advance.appliedCents;
        row.pendingAdvanceCents = advance.remainingCents;
        row.finalCents = advance.finalCents;
      });
      computed = true;
      totalWeightE8 = pool.totalWeightE8;
      totalAdvanceCents = advances.reduce((sum, a) => sum + a.appliedCents, 0n);
      totalFinalCents = advances.reduce((sum, a) => sum + a.finalCents, 0n);
      // Valor de 1,00 de ponderado y de 1 hora de cada puesto (con puntos = 1,00).
      pointValueCents = divRoundHalfUp(input.totalCents * ONE_WEIGHT, totalWeightE8);
      if (method === 'BY_POSITION') {
        const seen = new Set<string>();
        for (const row of participants) {
          const key = `${row.positionName ?? ''}|${row.factor ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hourValues.push({
            positionName: row.positionName ?? '—',
            factor: row.factor ?? '',
            centsPerHour: divRoundHalfUp(
              input.totalCents *
                participationWeight(
                  { hoursE2: 10n ** BigInt(HOURS_SCALE), factorE4: row.factorE4, pointsE2: null },
                  method,
                ),
              totalWeightE8,
            ),
          });
        }
      }
    } catch (error) {
      if (!(error instanceof ParticipationError)) throw error;
      issues.push(issue('ROUNDING', error.message));
    }
  }

  const totalHoursE2 = rows.reduce((sum, r) => sum + (r.hoursE2 ?? 0n), 0n);
  return {
    rows,
    issues,
    computed,
    canClose: computed && issues.length === 0,
    method,
    totalCents: input.totalCents,
    totalHoursE2,
    totalWeightE8,
    totalPointsE6: totalWeightE8 / WEIGHT_TO_E6,
    totalAdvanceCents,
    totalFinalCents,
    pointValueCents,
    hourValues,
  };
}
