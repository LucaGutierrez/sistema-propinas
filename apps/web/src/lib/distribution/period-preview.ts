/**
 * Reparto de un período (pantalla "Repartir propinas" y cierre en el servidor).
 *
 * Toma lo que cargó el usuario —propina del período, horas de cada persona y adelantos
 * pendientes— y arma el resultado con la fórmula de GUTIP (`computeProvisionalDistribution`, la
 * misma que usa la demo; no se cambia acá). La pantalla la usa para mostrar el resultado en vivo y
 * el servidor la vuelve a ejecutar con los datos de la base al cerrar: los dos llegan a los mismos
 * importes porque es la misma función con los mismos datos.
 *
 * Además de calcular, decide si el reparto se puede cerrar. Una persona activa SIN horas cargadas
 * nunca se reparte en silencio entre las demás: queda marcada "Sin horas cargadas" y bloquea el
 * cierre hasta que se cargue su número (0 si no trabajó).
 */
import { divRoundHalfUp, parseDecimal } from '@/lib/decimal';
import {
  computeProvisionalDistribution,
  FACTOR_SCALE,
  HOURS_SCALE,
  ProvisionalFormulaError,
} from './provisional-formula';

/** Horas de un período semanal: nadie puede tener más de 24 × 7 (la base aplica el mismo tope). */
export const MAX_PERIOD_HOURS = 168;
const MAX_PERIOD_HOURS_E2 = BigInt(MAX_PERIOD_HOURS) * 10n ** BigInt(HOURS_SCALE);

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
  positionName: string | null;
  factor: string | null;
  active: boolean;
  state: PersonState;
  hoursE2: bigint | null;
  factorE4: bigint | null;
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
  totalCents: bigint;
  totalHoursE2: bigint;
  totalPointsE6: bigint;
  totalAdvanceCents: bigint;
  totalFinalCents: bigint;
  /** Valor de 1 punto en centavos (null sin cálculo). */
  pointValueCents: bigint | null;
  /** Valor de la hora de cada puesto con horas (la explicación simple del cálculo). */
  hourValues: HourValue[];
}

/** Horas escritas → centésimas de hora; null si el número no es válido o supera el período. */
export function parseHours(text: string): bigint | null {
  const hoursE2 = parseDecimal(text, HOURS_SCALE);
  if (hoursE2 === null || hoursE2 > MAX_PERIOD_HOURS_E2) return null;
  return hoursE2;
}

function names(rows: readonly PreviewRow[]): string {
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
  people: readonly PreviewPerson[];
}): PeriodPreview {
  const rows: PreviewRow[] = input.people.map((person) => {
    const hoursE2 = person.hours === null ? null : parseHours(person.hours);
    const factorE4 = person.factor === null ? null : parseDecimal(person.factor, FACTOR_SCALE);
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
      positionName: person.positionName,
      factor: person.factor,
      active: person.active,
      state,
      hoursE2: state === 'missing' || state === 'invalid' ? null : hoursE2,
      factorE4,
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
  const noPosition = worked.filter((r) => r.factorE4 === null || r.factorE4 <= 0n);
  if (noPosition.length > 0) {
    issues.push(
      issue(
        'NO_POSITION',
        `${names(noPosition)} no tiene un puesto de la configuración: asignale uno en Personal.`,
        noPosition,
      ),
    );
  }
  const participants = worked.filter((r) => r.factorE4 !== null && r.factorE4 > 0n);
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
  let totalPointsE6 = 0n;
  let totalAdvanceCents = 0n;
  let totalFinalCents = 0n;
  let pointValueCents: bigint | null = null;
  const hourValues: HourValue[] = [];

  if (input.totalCents > 0n && participants.length > 0) {
    try {
      const result = computeProvisionalDistribution(
        input.totalCents,
        participants.map((r) => ({
          id: r.employeeId,
          hoursE2: r.hoursE2 ?? 0n,
          factorE4: r.factorE4 ?? 0n,
          advanceCents: r.pendingAdvanceCents,
        })),
        { unitCents: input.unitCents },
      );
      const byId = new Map(result.items.map((item) => [item.id, item]));
      for (const row of participants) {
        const item = byId.get(row.employeeId);
        if (!item) continue;
        row.pointsE6 = item.pointsE6;
        row.percentE2 = item.percentE2;
        row.amountCents = item.amountCents;
        row.advanceAppliedCents = item.advanceAppliedCents;
        row.pendingAdvanceCents = item.pendingAdvanceCents;
        row.finalCents = item.finalCents;
      }
      computed = true;
      totalPointsE6 = result.totalPointsE6;
      totalAdvanceCents = result.totalAdvanceCents;
      totalFinalCents = result.totalFinalCents;
      // Valor de 1 punto (puntos en millonésimas) y de 1 hora de cada puesto (100 centésimas).
      pointValueCents = divRoundHalfUp(input.totalCents * 1_000_000n, totalPointsE6);
      const seen = new Set<string>();
      for (const row of participants) {
        const key = `${row.positionName ?? ''}|${row.factor ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hourValues.push({
          positionName: row.positionName ?? '—',
          factor: row.factor ?? '',
          centsPerHour: divRoundHalfUp(
            input.totalCents * 10n ** BigInt(HOURS_SCALE) * (row.factorE4 ?? 0n),
            totalPointsE6,
          ),
        });
      }
    } catch (error) {
      if (!(error instanceof ProvisionalFormulaError)) throw error;
      issues.push(issue('ROUNDING', error.message));
    }
  }

  const totalHoursE2 = rows.reduce((sum, r) => sum + (r.hoursE2 ?? 0n), 0n);
  return {
    rows,
    issues,
    computed,
    canClose: computed && issues.length === 0,
    totalCents: input.totalCents,
    totalHoursE2,
    totalPointsE6,
    totalAdvanceCents,
    totalFinalCents,
    pointValueCents,
    hourValues,
  };
}
