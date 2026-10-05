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
 * Con la política "por sectores" (`sectors`), primero se calcula el monto de cada sector, en orden
 * (`sector-steps.ts`: cada uno sobre el total o sobre el saldo que queda) y después cada sector es
 * un pozo que se reparte entre la gente de SUS puestos con el mismo motor de participación. Un
 * sector sin puestos cobra su monto entero (no se reparte por persona).
 *
 * Además de calcular, decide si el reparto se puede cerrar. Una persona activa SIN horas cargadas
 * nunca se reparte en silencio entre las demás: queda marcada "Sin horas cargadas" y bloquea el
 * cierre hasta que se cargue su número (0 si no trabajó).
 */
import { divRoundHalfUp, formatMoney, parseDecimal } from '@/lib/decimal';
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
import { stepsToView, type SectorStepsView } from './sector-snapshot';
import {
  checkSectors,
  computeSectors,
  formatSectorPercent,
  sectorBaseLong,
  type SectorInput,
} from './sector-steps';

/** Configuración por sectores de la versión del período. */
export interface SectorConfig {
  sectors: readonly SectorInput[];
  /** Puestos de la versión (para validar y nombrar los puestos de cada sector). */
  positions: readonly { id: string; name: string }[];
  /**
   * Versión guardada con el formato anterior (cada puesto con etapa y %), sin sectores propios:
   * hay que volver a guardarla en Configuración antes de repartir.
   */
  legacy?: boolean;
}

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
  | 'SECTORS_CONFIG'
  | 'EMPTY_SECTOR'
  | 'NO_SECTOR'
  | 'UNASSIGNED'
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
  /**
   * Reparto por sectores: cada sector con su base, su monto y cuántas personas cobran en él, y lo
   * sin asignar. null con pozo único o si la configuración por sectores está incompleta.
   */
  sectors: SectorStepsView | null;
  /**
   * Lo que cobran los sectores SIN puestos (se entrega al sector entero, no a personas). Está
   * dentro del total; no está en `totalFinalCents`, que es lo de los sobres de cada persona.
   */
  sectorOnlyCents: bigint;
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
  /** Sectores de la política (reparto por sectores); null/ausente = pozo único. */
  sectors?: SectorConfig | null;
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
  let sectors: PeriodPreview['sectors'] = null;
  let sectorOnlyCents = 0n;

  // Por sectores: la configuración tiene que estar completa antes de calcular nada.
  const config = input.sectors ?? null;
  const sectorsCheck = config ? checkSectors(config.sectors, config.positions) : null;
  if (config?.legacy) {
    issues.push(
      issue(
        'SECTORS_CONFIG',
        'El reparto por sectores cambió de forma: entrá a Configuración → Reparto por sectores, revisá los sectores y guardalos de nuevo.',
      ),
    );
  } else if (sectorsCheck && !sectorsCheck.ok) {
    issues.push(
      issue(
        'SECTORS_CONFIG',
        `La configuración por sectores está incompleta: ${sectorsCheck.errors.join(' ')} Completala en Configuración.`,
      ),
    );
  }

  const weightOf = (r: PreviewRow) =>
    participationWeight(
      { hoursE2: r.hoursE2 ?? 0n, factorE4: r.factorE4, pointsE2: r.pointsE2 },
      method,
    );
  /** Valor de 1 hora de cada puesto en un pozo (solo BY_POSITION: con puntos varía por persona). */
  const pushHourValues = (
    members: readonly PreviewRow[],
    poolCents: bigint,
    poolWeightE8: bigint,
  ) => {
    if (method !== 'BY_POSITION' || poolWeightE8 === 0n) return;
    const seen = new Set<string>();
    for (const row of members) {
      const key = `${row.positionName ?? ''}|${row.factor ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hourValues.push({
        positionName: row.positionName ?? '—',
        factor: row.factor ?? '',
        centsPerHour: divRoundHalfUp(
          poolCents *
            participationWeight(
              { hoursE2: 10n ** BigInt(HOURS_SCALE), factorE4: row.factorE4, pointsE2: null },
              method,
            ),
          poolWeightE8,
        ),
      });
    }
  };

  if (
    input.totalCents > 0n &&
    participants.length > 0 &&
    !config?.legacy &&
    (!sectorsCheck || sectorsCheck.ok)
  ) {
    try {
      // Bruto de cada persona: su parte del pozo único, o del pozo de su sector.
      const shares = new Map<
        string,
        { weightE8: bigint; percentE2: bigint; amountCents: bigint }
      >();
      if (config && sectorsCheck?.ok) {
        const results = computeSectors(input.totalCents, sectorsCheck.sectors, input.unitCents);
        const people = new Map<string, number>();
        const empty: { name: string; amountCents: bigint }[] = [];
        const covered = new Set(results.flatMap((s) => s.positionIds));
        // Quien trabajó en un puesto que no está en ningún sector nunca cobra "de algún lado":
        // se avisa y no se puede cerrar hasta decidir a qué sector va su puesto.
        const outside = participants.filter(
          (r) => r.positionId !== null && !covered.has(r.positionId),
        );
        if (outside.length > 0) {
          const positions = [...new Set(outside.map((r) => r.positionName ?? '—'))].join(', ');
          issues.push(
            issue(
              'NO_SECTOR',
              `${names(outside)} tiene horas, pero su puesto (${positions}) no está en ningún sector. Agregalo a un sector en Configuración → Reparto por sectores, o poné 0 horas si no cobra.`,
              outside,
            ),
          );
        }
        for (const sector of results) {
          if (sector.positionIds.length === 0) {
            // Sector sin puestos: cobra el sector entero, sin reparto por persona.
            sectorOnlyCents += sector.amountCents;
            people.set(sector.id, 0);
            continue;
          }
          const inSector = (r: PreviewRow) =>
            r.positionId !== null && sector.positionIds.includes(r.positionId);
          const members = participants.filter(inSector);
          people.set(sector.id, members.length);
          if (members.length === 0) {
            // La plata de un sector sin nadie que cobre nunca pasa en silencio a otro sector. Si
            // todavía faltan horas de alguien del sector, ya lo dice MISSING_HOURS.
            const pending = rows.some(
              (r) => inSector(r) && r.active && (r.state === 'missing' || r.state === 'invalid'),
            );
            if (sector.amountCents > 0n && !pending) {
              empty.push({ name: sector.name, amountCents: sector.amountCents });
            }
            continue;
          }
          if (sector.amountCents === 0n) {
            for (const r of members) {
              shares.set(r.employeeId, { weightE8: weightOf(r), percentE2: 0n, amountCents: 0n });
            }
            continue;
          }
          const pool = computePool(
            sector.amountCents,
            members.map((r) => ({ id: r.employeeId, weightE8: weightOf(r) })),
            { unitCents: input.unitCents },
          );
          for (const share of pool.shares) {
            shares.set(share.id, {
              weightE8: share.weightE8,
              // Con sectores, la participación se expresa sobre el TOTAL de la propina.
              percentE2: divRoundHalfUp(share.amountCents * 10_000n, input.totalCents),
              amountCents: share.amountCents,
            });
          }
          pushHourValues(members, sector.amountCents, pool.totalWeightE8);
        }
        if (empty.length > 0) {
          issues.push(
            issue(
              'EMPTY_SECTOR',
              `${empty
                .map(
                  (e) =>
                    `Nadie de ${e.name} tiene horas y le corresponden ${formatMoney(e.amountCents)}.`,
                )
                .join(
                  ' ',
                )} Cargá las horas de su gente o revisá los sectores en Configuración: esa plata no pasa a otros sectores.`,
            ),
          );
        }
        const positionName = new Map(config.positions.map((p) => [p.id, p.name]));
        sectors = stepsToView(
          input.totalCents,
          results,
          (id) => positionName.get(id) ?? '—',
          people,
        );
        // Lo que queda después del último sector no se reparte solo: se muestra y no pasa a
        // nadie. El cierre registra cada peso del total, así que con plata sin asignar no cierra.
        const unassigned = BigInt(sectors.unassignedCents);
        const last = results[results.length - 1];
        if (unassigned > 0n && last) {
          issues.push(
            issue(
              'UNASSIGNED',
              `Quedan ${formatMoney(unassigned)} sin asignar: después de ${last.name} (${formatSectorPercent(last.percentE2)} % ${sectorBaseLong(last.base)}) sobra plata que no es de ningún sector. Para cerrar, en Configuración → Reparto por sectores subí el porcentaje del último sector (100 % del saldo se lleva todo lo que queda) o agregá un sector para ese saldo.`,
            ),
          );
        }
      } else {
        const pool = computePool(
          input.totalCents,
          participants.map((r) => ({ id: r.employeeId, weightE8: weightOf(r) })),
          { unitCents: input.unitCents },
        );
        for (const share of pool.shares) shares.set(share.id, share);
        // Valor de 1,00 de ponderado y de 1 hora de cada puesto (con puntos = 1,00).
        pointValueCents = divRoundHalfUp(input.totalCents * ONE_WEIGHT, pool.totalWeightE8);
        pushHourValues(participants, input.totalCents, pool.totalWeightE8);
      }

      const paid = participants.filter((r) => shares.has(r.employeeId));
      // Cada persona cobra de un solo pozo: su bruto es su importe en ese pozo.
      const advances = applyAdvances(
        paid.map((r) => ({
          id: r.employeeId,
          grossCents: shares.get(r.employeeId)?.amountCents ?? 0n,
          pendingCents: r.pendingAdvanceCents,
        })),
      );
      paid.forEach((row, index) => {
        const share = shares.get(row.employeeId);
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
      computed = paid.length > 0;
      totalWeightE8 = paid.reduce((sum, r) => sum + r.weightE8, 0n);
      totalAdvanceCents = advances.reduce((sum, a) => sum + a.appliedCents, 0n);
      totalFinalCents = advances.reduce((sum, a) => sum + a.finalCents, 0n);
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
    sectors,
    sectorOnlyCents,
  };
}
