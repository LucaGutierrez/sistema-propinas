/**
 * Modelo de la demo: semanas de propina, pozos diarios, cierre con sobres y personal.
 * Funciones puras sobre un estado JSON (se guarda en el navegador). Los importes se guardan
 * como strings de centavos porque JSON no admite bigint.
 *
 * Cómo se calcula lo define la política versionada de cada local (policy.ts, CONFIG-MODEL.md).
 * Cada semana queda fijada a una versión; el cierre guarda la versión y los valores usados.
 */
import { addDays, formatWeekRange, isIsoDate, mondayOf, weekDays } from '@/lib/dates';
import { formatScaled, parseMoney } from '@/lib/decimal';
import { calculateFromRows, type DistributionFormRow } from '@/lib/distribution/form';
import { RESTAURANT_NAME, SEED_STAFF, SEED_WEEK } from '@/lib/demo/data';
import type { DistributionConfig } from './config';
import {
  currentVersion,
  normalizePolicy,
  policyGaps,
  standardPolicy,
  versionOf,
  type PolicyVersion,
  type VenuePolicy,
} from './policy';
import type { Envelope } from './envelopes';

export type WeekStatus = 'ABIERTA' | 'CERRADA';

export interface Position {
  id: string;
  name: string;
  factor: string;
  /** Formato anterior del reparto por sectores: etapa del puesto; null/ausente = sin asignar. */
  stage?: number | null;
  /** Formato anterior: porcentaje de su etapa ("30", "12,5"); null/ausente = sin cargar. */
  stagePercent?: string | null;
  /** Reparto por sectores: sector de la versión en el que cobra; null/ausente = ninguno. */
  sectorId?: string | null;
}

export interface Staff {
  id: string;
  name: string;
  positionId: string;
  active: boolean;
}

/** Fila congelada al cerrar la semana: no cambia aunque después se edite el personal. */
export interface ClosedRow {
  staffId: string;
  name: string;
  positionId: string;
  positionName: string;
  hoursE2: string;
  factorE4: string;
  pointsE6: string;
  percentE2: string;
  amountCents: string;
  advanceCents: string;
  pendingAdvanceCents: string;
  finalCents: string;
}

export interface WeekResult {
  closedAt: string;
  totalCents: string;
  totalPointsE6: string;
  totalAdvanceCents: string;
  totalFinalCents: string;
  rows: ClosedRow[];
  /** Versión de la política con la que se cerró. */
  policyVersion?: number;
  /** Copia de los valores de la política usados (snapshot: cambiarla después no afecta este cierre). */
  config?: DistributionConfig;
}

/**
 * Un adelanto registrado (ver advances.ts). Nunca se borra: se anula con motivo.
 * `SALDO_ANTERIOR` es lo que no alcanzó a descontarse la semana previa.
 */
export interface AdvanceEntry {
  id: string;
  staffId: string;
  /** Fecha del adelanto, dentro de la semana. */
  date: string;
  amountCents: string;
  note: string;
  origin: 'MANUAL' | 'SALDO_ANTERIOR';
  /** Para `SALDO_ANTERIOR`: la semana de donde viene. */
  fromWeekId?: string;
  createdBy: string;
  createdAt: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

/** Un cierre anulado de la semana: se conserva completo para la auditoría. */
export interface VoidedRevision {
  revision: number;
  result: WeekResult;
  envelopes?: Record<string, Envelope>;
  voidedAt: string;
  voidedBy: string;
  voidReason: string;
}

export interface Week {
  id: string;
  startDate: string;
  status: WeekStatus;
  /** Pozo de cada día, tal como lo escribió el encargado ("45.500"). */
  tips: Record<string, string>;
  hours: Record<string, string>;
  advanceEntries: AdvanceEntry[];
  note?: string;
  result?: WeekResult;
  /** Estado de cada sobre (por staffId), después del cierre. Ver envelopes.ts. */
  envelopes?: Record<string, Envelope>;
  /** 1 la primera vez; sube cada vez que se anula el cierre y se vuelve a cerrar. */
  revision?: number;
  voidedRevisions?: VoidedRevision[];
  /** Versión de la política fijada a este período (se fija al empezar la semana). */
  policyVersion?: number;
  /** Cambios de versión mientras la semana estuvo abierta: quién, cuándo, de cuál a cuál y por qué. */
  policyLog?: PolicyLogEntry[];
}

export interface PolicyLogEntry {
  at: string;
  by: string;
  from: number;
  to: number;
  /** Automático al cambiar la política con la semana abierta, o elegido a mano (con motivo). */
  automatic: boolean;
  reason?: string;
}

/** Permiso de una persona con acceso a un local. */
export type Role = 'ENCARGADO' | 'EDITOR' | 'LECTOR' | 'PROPIO';

/** Persona invitada a ver o editar un local (no confundir con el personal que cobra). */
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Su ficha en el personal del local. Obligatoria para "Solo lo suyo". */
  staffId: string | null;
  /** En la demo nadie puede aceptar todavía: las invitaciones quedan pendientes. */
  status: 'INVITADO' | 'ACTIVO';
  invitedAt: string;
}

/** Un local (p. ej. "Faena Library"): su política, su personal, sus semanas y su historial. */
export interface Venue {
  id: string;
  name: string;
  /** Cómo calcula este local (versionada; incluye los puestos con su peso). Solo afecta a este local. */
  policy: VenuePolicy;
  /** Quiénes trabajan y en qué puesto. No es parte de la política. */
  staff: Staff[];
  weeks: Week[];
  members: Member[];
}

export type Outcome = { ok: true; venue: Venue } | { ok: false; error: string };

const fail = (error: string): Outcome => ({ ok: false, error });

// ---------------------------------------------------------------------------------------------
// Lecturas

export function openWeek(venue: Venue): Week | undefined {
  return venue.weeks.find((week) => week.status === 'ABIERTA');
}

export function findWeek(venue: Venue, id: string): Week | undefined {
  return venue.weeks.find((week) => week.id === id);
}

/** Semanas de la más nueva a la más vieja. */
export function sortedWeeks(venue: Venue): Week[] {
  return [...venue.weeks].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

/** Puestos de la versión vigente de la política. */
export function positionsOf(venue: Venue): Position[] {
  return currentVersion(venue.policy).positions;
}

export function positionById(venue: Venue, id: string): Position | undefined {
  return positionsOf(venue).find((p) => p.id === id);
}

/** Versión de la política con la que se calcula la semana (la fijada al empezarla). */
export function weekPolicy(venue: Venue, week: Week): PolicyVersion {
  return (
    (week.policyVersion !== undefined ? versionOf(venue.policy, week.policyVersion) : undefined) ??
    currentVersion(venue.policy)
  );
}

export interface WeekTotal {
  totalCents: bigint;
  daysWithTips: number;
  invalidDays: string[];
}

export function weekTotal(week: Week): WeekTotal {
  let totalCents = 0n;
  let daysWithTips = 0;
  const invalidDays: string[] = [];
  for (const date of weekDays(week.startDate)) {
    const raw = week.tips[date] ?? '';
    if (raw.trim() === '') continue;
    const cents = parseMoney(raw);
    if (cents === null) {
      invalidDays.push(date);
      continue;
    }
    if (cents > 0n) daysWithTips += 1;
    totalCents += cents;
  }
  return { totalCents, daysWithTips, invalidDays };
}

/** Filas del reparto: personal activo con el factor de su puesto. */
export function weekFormRows(venue: Venue, week: Week): DistributionFormRow[] {
  const policy = weekPolicy(venue, week);
  return venue.staff
    .filter((member) => member.active)
    .map((member) => ({
      id: member.id,
      name: member.name,
      hours: week.hours[member.id] ?? '',
      factor: policy.positions.find((p) => p.id === member.positionId)?.factor ?? '',
      advance: formatAdvance(advanceTotal(week, member.id)),
    }));
}

/** Unidad de reparto según la configuración del local. Solo están implementadas centavo y peso. */
export function roundingUnitCents(values: DistributionConfig): bigint {
  return values.rounding === 'PESO' ? 100n : 1n;
}

/** Adelantos vigentes (no anulados) de la semana. */
export function activeAdvances(week: Week): AdvanceEntry[] {
  return week.advanceEntries.filter((entry) => !entry.voidedAt);
}

/**
 * Total de adelantos vigentes de una persona en la semana. PROVISIONAL (P6): se descuentan todos
 * del sobre de la semana, sin importar la fecha de cada uno.
 */
export function advanceTotal(week: Week, staffId: string): bigint {
  return activeAdvances(week)
    .filter((entry) => entry.staffId === staffId)
    .reduce((sum, entry) => sum + BigInt(entry.amountCents), 0n);
}

const formatAdvance = (cents: bigint) => (cents > 0n ? formatScaled(cents, 2, 2) : '');

export function calculateWeek(venue: Venue, week: Week) {
  const total = weekTotal(week);
  if (total.invalidDays.length > 0) {
    return {
      ok: false as const,
      errors: total.invalidDays.map((date) => `Pozo inválido el día ${date}.`),
    };
  }
  return calculateFromRows(total.totalCents, weekFormRows(venue, week), {
    unitCents: roundingUnitCents(weekPolicy(venue, week).values),
  });
}

export interface MonthSummary {
  /** "2024-11" */
  month: string;
  /** Propina generada: suma de los pozos diarios con fecha en el mes. */
  generatedCents: bigint;
  daysWithTips: number;
  /** Semanas cerradas cuyo último día cae en el mes. */
  closedWeeks: number;
  /** Total entregado en sobres en esas semanas. */
  envelopesCents: bigint;
}

/** Resumen por mes, del más nuevo al más viejo. */
export function monthlySummary(venue: Venue): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const get = (month: string) => {
    let summary = months.get(month);
    if (!summary) {
      summary = { month, generatedCents: 0n, daysWithTips: 0, closedWeeks: 0, envelopesCents: 0n };
      months.set(month, summary);
    }
    return summary;
  };
  for (const week of venue.weeks) {
    for (const date of weekDays(week.startDate)) {
      const cents = parseMoney(week.tips[date] ?? '');
      if (cents === null || cents === 0n) continue;
      const summary = get(date.slice(0, 7));
      summary.generatedCents += cents;
      summary.daysWithTips += 1;
    }
    if (week.status === 'CERRADA' && week.result) {
      const summary = get(addDays(week.startDate, 6).slice(0, 7));
      summary.closedWeeks += 1;
      summary.envelopesCents += BigInt(week.result.totalFinalCents);
    }
  }
  return [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

// ---------------------------------------------------------------------------------------------
// Semanas

/**
 * Fecha sugerida para empezar la próxima semana: el lunes de `today`, o el día siguiente a la
 * última semana registrada si ese lunes ya está ocupado.
 */
export function suggestedStartDate(venue: Venue, today: string): string {
  const monday = mondayOf(today);
  const latestEnd = venue.weeks
    .map((week) => addDays(week.startDate, 6))
    .reduce<string | null>((max, end) => (max === null || end > max ? end : max), null);
  if (latestEnd === null || latestEnd < monday) return monday;
  return addDays(latestEnd, 1);
}

export function startWeek(venue: Venue, startDate: string, id: string, at: string): Outcome {
  if (!isIsoDate(startDate)) return fail('Elegí la fecha de inicio de la semana.');
  if (openWeek(venue)) return fail('Ya hay una semana abierta: cerrala antes de empezar otra.');
  const endDate = addDays(startDate, 6);
  const overlap = venue.weeks.find(
    (week) => week.startDate <= endDate && addDays(week.startDate, 6) >= startDate,
  );
  if (overlap) return fail('Esas fechas se superponen con una semana ya registrada.');

  // Saldo de adelantos de la última semana cerrada: entra como un movimiento más.
  const lastClosed = sortedWeeks(venue).find((week) => week.status === 'CERRADA' && week.result);
  const advanceEntries: AdvanceEntry[] = [];
  for (const row of lastClosed?.result?.rows ?? []) {
    const pending = BigInt(row.pendingAdvanceCents);
    if (pending > 0n && lastClosed) {
      advanceEntries.push({
        id: `${id}-saldo-${row.staffId}`,
        staffId: row.staffId,
        date: startDate,
        amountCents: pending.toString(),
        note: `Saldo de la ${formatWeekRange(lastClosed.startDate).toLowerCase()}`,
        origin: 'SALDO_ANTERIOR',
        fromWeekId: lastClosed.id,
        createdBy: 'GUTIP',
        createdAt: at,
      });
    }
  }

  const week: Week = {
    id,
    startDate,
    status: 'ABIERTA',
    tips: {},
    hours: {},
    advanceEntries,
    revision: 1,
    // El período queda fijado a la versión vigente de la política.
    policyVersion: venue.policy.current,
  };
  return { ok: true, venue: { ...venue, weeks: [...venue.weeks, week] } };
}

type WeekField = 'tips' | 'hours';

function editOpenWeek(
  venue: Venue,
  weekId: string,
  field: WeekField,
  key: string,
  value: string,
): Outcome {
  const week = findWeek(venue, weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'ABIERTA') return fail('La semana está cerrada: no se puede modificar.');
  const updated: Week = { ...week, [field]: { ...week[field], [key]: value } };
  return {
    ok: true,
    venue: { ...venue, weeks: venue.weeks.map((w) => (w.id === weekId ? updated : w)) },
  };
}

export function setDailyTip(venue: Venue, weekId: string, date: string, value: string): Outcome {
  const week = findWeek(venue, weekId);
  if (week && !weekDays(week.startDate).includes(date))
    return fail('Ese día no es de esta semana.');
  return editOpenWeek(venue, weekId, 'tips', date, value);
}

export function setHours(venue: Venue, weekId: string, staffId: string, value: string): Outcome {
  return editOpenWeek(venue, weekId, 'hours', staffId, value);
}

/** Cierra la semana: reparte el pozo total y congela el resultado (sobres). */
export function closeWeek(venue: Venue, weekId: string, closedAt: string): Outcome {
  const week = findWeek(venue, weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'ABIERTA') return fail('La semana ya está cerrada.');
  const gaps = policyGaps(weekPolicy(venue, week));
  if (gaps.length > 0) return fail(`La política tiene puntos por definir: ${gaps.join(' ')}`);
  const outcome = calculateWeek(venue, week);
  if (!outcome.ok) return fail(outcome.errors.join(' '));

  const { result } = outcome;
  const staffById = new Map(venue.staff.map((member) => [member.id, member]));
  const rows: ClosedRow[] = result.items
    .filter(
      (item) =>
        item.pointsE6 > 0n || item.advanceAppliedCents > 0n || item.pendingAdvanceCents > 0n,
    )
    .map((item) => {
      const member = staffById.get(item.id);
      const position = member
        ? weekPolicy(venue, week).positions.find((p) => p.id === member.positionId)
        : undefined;
      return {
        staffId: item.id,
        name: member?.name ?? item.id,
        positionId: member?.positionId ?? '',
        positionName: position?.name ?? '',
        hoursE2: item.hoursE2.toString(),
        factorE4: item.factorE4.toString(),
        pointsE6: item.pointsE6.toString(),
        percentE2: item.percentE2.toString(),
        amountCents: item.amountCents.toString(),
        advanceCents: item.advanceAppliedCents.toString(),
        pendingAdvanceCents: item.pendingAdvanceCents.toString(),
        finalCents: item.finalCents.toString(),
      };
    });

  const closed: Week = {
    ...week,
    status: 'CERRADA',
    // Sobres nuevos en cada cierre (también al volver a cerrar tras una anulación).
    envelopes: undefined,
    result: {
      closedAt,
      totalCents: result.totalCents.toString(),
      totalPointsE6: result.totalPointsE6.toString(),
      totalAdvanceCents: result.totalAdvanceCents.toString(),
      totalFinalCents: result.totalFinalCents.toString(),
      policyVersion: weekPolicy(venue, week).number,
      config: { ...weekPolicy(venue, week).values },
      rows,
    },
  };
  return {
    ok: true,
    venue: { ...venue, weeks: venue.weeks.map((w) => (w.id === weekId ? closed : w)) },
  };
}

// ---------------------------------------------------------------------------------------------
// Personal y puestos

// Los puestos (con su peso) son parte de la política: se agregan o cambian en policy-ops.ts.

export function addStaff(venue: Venue, member: Omit<Staff, 'active'>): Outcome {
  const name = member.name.trim();
  if (name === '') return fail('Poné el nombre de la persona.');
  if (!positionById(venue, member.positionId)) return fail('Elegí un puesto.');
  if (venue.staff.some((s) => s.active && s.name.toLowerCase() === name.toLowerCase())) {
    return fail(`Ya hay alguien activo llamado "${name}".`);
  }
  return {
    ok: true,
    venue: { ...venue, staff: [...venue.staff, { ...member, name, active: true }] },
  };
}

/** Dar de baja o reactivar. Nunca se borra: las semanas cerradas siguen mostrando a la persona. */
export function setStaffActive(venue: Venue, staffId: string, active: boolean): Outcome {
  if (!venue.staff.some((s) => s.id === staffId)) return fail('Esa persona no existe.');
  return {
    ok: true,
    venue: { ...venue, staff: venue.staff.map((s) => (s.id === staffId ? { ...s, active } : s)) },
  };
}

export function setStaffPosition(venue: Venue, staffId: string, positionId: string): Outcome {
  if (!positionById(venue, positionId)) return fail('Ese puesto no existe.');
  return {
    ok: true,
    venue: {
      ...venue,
      staff: venue.staff.map((s) => (s.id === staffId ? { ...s, positionId } : s)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Estado inicial

/** Local de ejemplo: personal y puestos de la planilla, con su semana ya cerrada. */
export function seedVenue(closedAt: string): Venue {
  const base: Venue = {
    id: 'local-demo',
    name: RESTAURANT_NAME,
    policy: standardPolicy(closedAt),
    staff: SEED_STAFF.map(({ id, name, positionId }) => ({ id, name, positionId, active: true })),
    // La planilla de referencia es de Library (Hotel Faena): lo que ese restaurante confirmó.
    // Dos invitaciones de ejemplo para probar "Ver como…".
    members: [
      {
        id: 'miembro-leo',
        name: 'Leo',
        email: '',
        role: 'EDITOR',
        staffId: 'leo',
        status: 'INVITADO',
        invitedAt: closedAt,
      },
      {
        id: 'miembro-nahuel',
        name: 'Nahuel',
        email: '',
        role: 'PROPIO',
        staffId: 'nahuel',
        status: 'INVITADO',
        invitedAt: closedAt,
      },
    ],
    weeks: [
      {
        id: 'semana-planilla',
        startDate: SEED_WEEK.startDate,
        status: 'ABIERTA',
        tips: { [SEED_WEEK.tipDate]: SEED_WEEK.total },
        hours: Object.fromEntries(SEED_STAFF.map((s) => [s.id, s.weekHours])),
        advanceEntries: SEED_STAFF.filter((s) => s.advance).map((s): AdvanceEntry => ({
          id: `semana-planilla-adelanto-${s.id}`,
          staffId: s.id,
          date: SEED_WEEK.tipDate,
          amountCents: (parseMoney(s.advance) ?? 0n).toString(),
          note: 'Adelanto de la planilla',
          origin: 'MANUAL',
          createdBy: 'Encargado',
          createdAt: closedAt,
        })),
        revision: 1,
        policyVersion: 1,
        note: SEED_WEEK.note,
      },
    ],
  };
  const closed = closeWeek(base, 'semana-planilla', closedAt);
  if (!closed.ok) throw new Error(`Datos demo inválidos: ${closed.error}`);
  return closed.venue;
}

/** Local nuevo y vacío, con los puestos que se indiquen (se copian, no se comparten). */
export function emptyVenue(id: string, name: string, policy: VenuePolicy): Venue {
  return { id, name, policy, staff: [], weeks: [], members: [] };
}

/**
 * Valida un local leído del navegador y completa lo que falte de versiones anteriores
 * (los locales guardados antes de las invitaciones no tienen `members`).
 */
export function normalizeVenue(value: unknown): Venue | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<Venue>;
  const valid =
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.staff) &&
    Array.isArray(v.weeks);
  if (!valid) return null;
  return {
    ...(v as Venue),
    weeks: (v.weeks as unknown[]).map(normalizeWeek),
    policy: normalizePolicy(v as { policy?: unknown; positions?: unknown; config?: unknown }),
    members: Array.isArray(v.members) ? v.members : [],
  };
}

/**
 * Semanas guardadas antes del registro de adelantos tenían un monto por persona (`advances`) y
 * el saldo arrastrado (`carried`). Se convierten en movimientos, sin cambiar los importes.
 */
function normalizeWeek(raw: unknown): Week {
  const week = raw as Week & {
    advances?: Record<string, string>;
    carried?: Record<string, string>;
  };
  // Semanas guardadas antes de las versiones: la única política que existía es la versión 1.
  if (Array.isArray(week.advanceEntries))
    return { ...week, policyVersion: week.policyVersion ?? 1 };

  const { advances = {}, carried = {}, ...rest } = week;
  // Mediodía UTC: en Argentina sigue siendo el mismo día (medianoche UTC se vería como el día anterior).
  const at = week.result?.closedAt ?? `${week.startDate}T12:00:00.000Z`;
  const advanceEntries: AdvanceEntry[] = [];
  for (const [staffId, text] of Object.entries(advances)) {
    const total = parseMoney(text) ?? 0n;
    const carriedCents = BigInt(carried[staffId] ?? '0');
    const manual = total - carriedCents;
    if (carriedCents > 0n) {
      advanceEntries.push({
        id: `${week.id}-saldo-${staffId}`,
        staffId,
        date: week.startDate,
        amountCents: carriedCents.toString(),
        note: 'Saldo de la semana anterior',
        origin: 'SALDO_ANTERIOR',
        createdBy: 'GUTIP',
        createdAt: at,
      });
    }
    if (manual > 0n) {
      advanceEntries.push({
        id: `${week.id}-adelanto-${staffId}`,
        staffId,
        date: week.startDate,
        amountCents: manual.toString(),
        note: 'Cargado antes del registro de adelantos',
        origin: 'MANUAL',
        createdBy: 'Encargado',
        createdAt: at,
      });
    }
  }
  return {
    ...rest,
    advanceEntries,
    revision: week.revision ?? 1,
    policyVersion: week.policyVersion ?? 1,
  };
}
