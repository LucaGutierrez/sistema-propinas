/**
 * Modelo de la demo: semanas de propina, pozos diarios, cierre con sobres y personal.
 * Funciones puras sobre un estado JSON (se guarda en el navegador). Los importes se guardan
 * como strings de centavos porque JSON no admite bigint.
 *
 * Flujo acordado (2026-09-26): el encargado anota el pozo de cada día; al cerrar la semana se
 * suman los pozos y se hace UN reparto con las horas totales de la semana (fórmula provisional).
 */
import { addDays, isIsoDate, mondayOf, weekDays } from '@/lib/dates';
import { formatScaled, parseDecimal, parseMoney } from '@/lib/decimal';
import { calculateFromRows, type DistributionFormRow } from '@/lib/distribution/form';
import { FACTOR_SCALE } from '@/lib/distribution/provisional-formula';
import { RESTAURANT_NAME, SEED_POSITIONS, SEED_STAFF, SEED_WEEK } from '@/lib/demo/data';
import type { Envelope } from './envelopes';

export type WeekStatus = 'ABIERTA' | 'CERRADA';

export interface Position {
  id: string;
  name: string;
  factor: string;
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
}

export interface Week {
  id: string;
  startDate: string;
  status: WeekStatus;
  /** Pozo de cada día, tal como lo escribió el encargado ("45.500"). */
  tips: Record<string, string>;
  hours: Record<string, string>;
  advances: Record<string, string>;
  /** Saldo de adelantos que viene de la semana anterior (centavos), ya sumado en `advances`. */
  carried: Record<string, string>;
  note?: string;
  result?: WeekResult;
  /** Estado de cada sobre (por staffId), después del cierre. Ver envelopes.ts. */
  envelopes?: Record<string, Envelope>;
}

/** Un local (p. ej. "Faena Library"): su propio personal, puestos, semanas e historial. */
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

export interface Venue {
  id: string;
  name: string;
  positions: Position[];
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

export function positionById(venue: Venue, id: string): Position | undefined {
  return venue.positions.find((p) => p.id === id);
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
  return venue.staff
    .filter((member) => member.active)
    .map((member) => ({
      id: member.id,
      name: member.name,
      hours: week.hours[member.id] ?? '',
      factor: positionById(venue, member.positionId)?.factor ?? '',
      advance: week.advances[member.id] ?? '',
    }));
}

export function calculateWeek(venue: Venue, week: Week) {
  const total = weekTotal(week);
  if (total.invalidDays.length > 0) {
    return {
      ok: false as const,
      errors: total.invalidDays.map((date) => `Pozo inválido el día ${date}.`),
    };
  }
  return calculateFromRows(total.totalCents, weekFormRows(venue, week));
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

export function startWeek(venue: Venue, startDate: string, id: string): Outcome {
  if (!isIsoDate(startDate)) return fail('Elegí la fecha de inicio de la semana.');
  if (openWeek(venue)) return fail('Ya hay una semana abierta: cerrala antes de empezar otra.');
  const endDate = addDays(startDate, 6);
  const overlap = venue.weeks.find(
    (week) => week.startDate <= endDate && addDays(week.startDate, 6) >= startDate,
  );
  if (overlap) return fail('Esas fechas se superponen con una semana ya registrada.');

  // Saldo de adelantos de la última semana cerrada.
  const lastClosed = sortedWeeks(venue).find((week) => week.status === 'CERRADA' && week.result);
  const carried: Record<string, string> = {};
  const advances: Record<string, string> = {};
  for (const row of lastClosed?.result?.rows ?? []) {
    const pending = BigInt(row.pendingAdvanceCents);
    if (pending > 0n) {
      carried[row.staffId] = pending.toString();
      advances[row.staffId] = formatScaled(pending, 2, 2);
    }
  }

  const week: Week = { id, startDate, status: 'ABIERTA', tips: {}, hours: {}, advances, carried };
  return { ok: true, venue: { ...venue, weeks: [...venue.weeks, week] } };
}

type WeekField = 'tips' | 'hours' | 'advances';

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

export function setAdvance(venue: Venue, weekId: string, staffId: string, value: string): Outcome {
  return editOpenWeek(venue, weekId, 'advances', staffId, value);
}

/** Cierra la semana: reparte el pozo total y congela el resultado (sobres). */
export function closeWeek(venue: Venue, weekId: string, closedAt: string): Outcome {
  const week = findWeek(venue, weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'ABIERTA') return fail('La semana ya está cerrada.');
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
      const position = member ? positionById(venue, member.positionId) : undefined;
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
    result: {
      closedAt,
      totalCents: result.totalCents.toString(),
      totalPointsE6: result.totalPointsE6.toString(),
      totalAdvanceCents: result.totalAdvanceCents.toString(),
      totalFinalCents: result.totalFinalCents.toString(),
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

export function addPosition(venue: Venue, position: Position): Outcome {
  const name = position.name.trim();
  if (name === '') return fail('Poné un nombre para el puesto.');
  if (venue.positions.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return fail(`Ya existe el puesto "${name}".`);
  }
  const factorE4 = parseDecimal(position.factor, FACTOR_SCALE);
  if (factorE4 === null || factorE4 === 0n) {
    return fail('El factor tiene que ser un número mayor que cero (hasta 4 decimales).');
  }
  return {
    ok: true,
    venue: {
      ...venue,
      positions: [...venue.positions, { ...position, name, factor: position.factor.trim() }],
    },
  };
}

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
    positions: SEED_POSITIONS.map((p) => ({ ...p })),
    staff: SEED_STAFF.map(({ id, name, positionId }) => ({ id, name, positionId, active: true })),
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
        advances: Object.fromEntries(
          SEED_STAFF.filter((s) => s.advance).map((s) => [s.id, s.advance]),
        ),
        carried: {},
        note: SEED_WEEK.note,
      },
    ],
  };
  const closed = closeWeek(base, 'semana-planilla', closedAt);
  if (!closed.ok) throw new Error(`Datos demo inválidos: ${closed.error}`);
  return closed.venue;
}

/** Local nuevo y vacío, con los puestos que se indiquen (se copian, no se comparten). */
export function emptyVenue(id: string, name: string, positions: readonly Position[]): Venue {
  return {
    id,
    name,
    positions: positions.map((p) => ({ ...p })),
    staff: [],
    weeks: [],
    members: [],
  };
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
    Array.isArray(v.positions) &&
    Array.isArray(v.staff) &&
    Array.isArray(v.weeks);
  if (!valid) return null;
  return { ...(v as Venue), members: Array.isArray(v.members) ? v.members : [] };
}
