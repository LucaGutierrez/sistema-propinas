/**
 * Lecturas del reparto (período). TODAS filtran por `restaurantId`: un período, una persona o un
 * adelanto de otro restaurante no existen para esta capa.
 *
 * `loadPeriodData` es la ÚNICA forma de juntar lo que entra al cálculo (política del período,
 * personas con su puesto y porción, horas, propina y adelantos pendientes). La usan la pantalla
 * (vista previa en vivo) y el cierre (dentro de su transacción): los dos calculan con lo mismo.
 */
import type { PreviewPerson } from '@/lib/distribution/period-preview';
import {
  hoursText,
  PERIOD_TOTAL_NOTE,
  type ClosedPeriodView,
  type OpenPeriodView,
  type PeriodAdvanceView,
  type PeriodListItem,
  type TipsMode,
} from '@/lib/distribution/period-view';
import { roleAllowed, CAN, type Role } from '../access/roles';
import { getPolicyVersion, type DbClient, type PolicyVersionRecord } from '../policy/repository';
import { displayName } from '../staff/repository';

/** Fecha de calendario de la base (`@db.Date`, medianoche UTC) ↔ "2026-09-21". */
export const isoOf = (date: Date): string => date.toISOString().slice(0, 10);
export const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

export interface PeriodRow {
  id: string;
  weekStart: string;
  weekEnd: string;
  policyVersionId: string;
}

export interface PendingAdvance {
  id: string;
  employeeId: string;
  date: string;
  amountCents: bigint;
  appliedCents: bigint;
  note: string | null;
  createdByName: string;
}

export interface PeriodData {
  period: PeriodRow;
  policy: PolicyVersionRecord;
  distributionId: string | null;
  tips: { mode: TipsMode; totalCents: bigint; days: { date: string; amountCents: bigint }[] };
  people: PreviewPerson[];
  /** Adelantos pendientes (con saldo) de fecha ≤ fin del período, del más viejo al más nuevo. */
  advances: PendingAdvance[];
  unitCents: bigint;
}

export function unitCentsOf(policy: PolicyVersionRecord): bigint {
  return policy.columns.roundingUnit === 'PESO' ? 100n : 1n;
}

/** Todo lo que entra al cálculo de un período del restaurante (null si no existe). */
export async function loadPeriodData(
  db: DbClient,
  restaurantId: string,
  period: PeriodRow,
): Promise<PeriodData | null> {
  const [policy, employees, hours, distribution, advances] = await Promise.all([
    getPolicyVersion(db, restaurantId, period.policyVersionId),
    db.employee.findMany({
      where: { restaurantId, archivedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, firstName: true, lastName: true, defaultPositionId: true, active: true },
    }),
    db.periodHours.findMany({
      where: { restaurantId, settlementId: period.id },
      select: { employeeId: true, hours: true },
    }),
    db.dailyDistribution.findFirst({
      where: {
        restaurantId,
        scope: 'PERIOD',
        status: 'DRAFT',
        dateFrom: dateOf(period.weekStart),
        dateTo: dateOf(period.weekEnd),
      },
      select: {
        id: true,
        tipEntries: {
          select: { entryDate: true, amountArsCents: true, note: true },
          orderBy: { entryDate: 'asc' },
        },
      },
    }),
    db.advance.findMany({
      where: { restaurantId, status: 'PENDING', date: { lte: dateOf(period.weekEnd) } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        date: true,
        amountCents: true,
        appliedCents: true,
        note: true,
        createdBy: { select: { name: true } },
      },
    }),
  ]);
  if (!policy) return null;

  const pending: PendingAdvance[] = advances.map((a) => ({
    id: a.id,
    employeeId: a.employeeId,
    date: isoOf(a.date),
    amountCents: a.amountCents,
    appliedCents: a.appliedCents,
    note: a.note,
    createdByName: a.createdBy.name,
  }));
  const advanceByEmployee = new Map<string, bigint>();
  for (const a of pending) {
    advanceByEmployee.set(
      a.employeeId,
      (advanceByEmployee.get(a.employeeId) ?? 0n) + a.amountCents - a.appliedCents,
    );
  }

  const hoursByEmployee = new Map(hours.map((h) => [h.employeeId, hoursText(h.hours.toFixed(2))]));
  const positions = new Map(policy.positions.map((p) => [p.positionId, p]));
  // Personas del reparto: las activas, y las dadas de baja que ya tenían horas en este período.
  const people: PreviewPerson[] = employees
    .filter((e) => e.active || hoursByEmployee.has(e.id))
    .map((e) => {
      const position = e.defaultPositionId ? positions.get(e.defaultPositionId) : undefined;
      return {
        employeeId: e.id,
        name: displayName(e),
        positionId: position?.positionId ?? null,
        positionName: position?.name ?? null,
        factor: position?.factor ?? null,
        hours: hoursByEmployee.get(e.id) ?? null,
        advanceCents: advanceByEmployee.get(e.id) ?? 0n,
        active: e.active,
      };
    });
  // Como la planilla: agrupadas por puesto (en el orden de la configuración); dentro, por alta.
  const order = new Map(policy.positions.map((p, index) => [p.name, index]));
  const indexed = people.map((person, index) => ({ person, index }));
  indexed.sort(
    (a, b) =>
      (order.get(a.person.positionName ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.person.positionName ?? '') ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
  );

  const entries = distribution?.tipEntries ?? [];
  const totalCents = entries.reduce((sum, e) => sum + e.amountArsCents, 0n);
  const daily = entries.some((e) => e.note !== PERIOD_TOTAL_NOTE);
  const byDay = new Map<string, bigint>();
  for (const e of entries) {
    const date = isoOf(e.entryDate);
    byDay.set(date, (byDay.get(date) ?? 0n) + e.amountArsCents);
  }

  return {
    period,
    policy,
    distributionId: distribution?.id ?? null,
    tips: {
      mode: daily ? 'daily' : 'total',
      totalCents,
      days: [...byDay].map(([date, amountCents]) => ({ date, amountCents })),
    },
    people: indexed.map((i) => i.person),
    advances: pending,
    unitCents: unitCentsOf(policy),
  };
}

const periodSelect = { id: true, weekStart: true, weekEnd: true, policyVersionId: true } as const;

function toPeriodRow(row: {
  id: string;
  weekStart: Date;
  weekEnd: Date;
  policyVersionId: string;
}): PeriodRow {
  return {
    id: row.id,
    weekStart: isoOf(row.weekStart),
    weekEnd: isoOf(row.weekEnd),
    policyVersionId: row.policyVersionId,
  };
}

/** El período abierto del restaurante (el más reciente, si hubiera más de uno). */
export async function findOpenPeriod(
  db: DbClient,
  restaurantId: string,
): Promise<PeriodRow | null> {
  const row = await db.weeklySettlement.findFirst({
    where: { restaurantId, status: 'OPEN' },
    orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }],
    select: periodSelect,
  });
  return row ? toPeriodRow(row) : null;
}

/** Pantalla "Repartir propinas" con el período abierto (null si no hay ninguno abierto). */
export async function getOpenPeriodView(
  db: DbClient,
  access: { restaurantId: string; role: Role },
): Promise<OpenPeriodView | null> {
  const period = await findOpenPeriod(db, access.restaurantId);
  if (!period) return null;
  const data = await loadPeriodData(db, access.restaurantId, period);
  if (!data) return null;
  const names = new Map(data.people.map((p) => [p.employeeId, p.name]));
  const advances: PeriodAdvanceView[] = data.advances.map((a) => ({
    id: a.id,
    employeeId: a.employeeId,
    employeeName: names.get(a.employeeId) ?? '—',
    date: a.date,
    amountCents: a.amountCents.toString(),
    balanceCents: (a.amountCents - a.appliedCents).toString(),
    note: a.note,
    createdByName: a.createdByName,
    carried: a.date < period.weekStart,
  }));
  return {
    settlementId: period.id,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    policyVersion: data.policy.number,
    roundingUnit: data.policy.columns.roundingUnit,
    unitCents: data.unitCents.toString(),
    tips: {
      mode: data.tips.mode,
      totalCents: data.tips.totalCents.toString(),
      days: data.tips.days.map((d) => ({ date: d.date, amountCents: d.amountCents.toString() })),
    },
    people: data.people.map((p) => ({ ...p, advanceCents: p.advanceCents.toString() })),
    advances,
    canEdit: roleAllowed(access.role, CAN.editPeriod),
    canClose: roleAllowed(access.role, CAN.closePeriod),
  };
}

/** Repartos del restaurante (abiertos y cerrados; los anulados no), del más nuevo al más viejo. */
export async function listPeriods(
  db: DbClient,
  restaurantId: string,
  take = 10,
): Promise<PeriodListItem[]> {
  const rows = await db.weeklySettlement.findMany({
    where: { restaurantId, status: { in: ['OPEN', 'CLOSED'] } },
    orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      weekStart: true,
      weekEnd: true,
      status: true,
      totalCents: true,
      totalFinalCents: true,
      closedAt: true,
    },
  });
  return rows.map((r) => ({
    settlementId: r.id,
    weekStart: isoOf(r.weekStart),
    weekEnd: isoOf(r.weekEnd),
    status: r.status === 'OPEN' ? 'OPEN' : 'CLOSED',
    totalCents: r.totalCents?.toString() ?? null,
    totalFinalCents: r.totalFinalCents?.toString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
  }));
}

/** Estado del reparto para el inicio: el abierto (cuánto falta) y los últimos cerrados. */
export interface PeriodOverview {
  open: {
    settlementId: string;
    weekStart: string;
    weekEnd: string;
    tipsCents: string;
    peopleWithHours: number;
    activePeople: number;
  } | null;
  recent: PeriodListItem[];
}

export async function getPeriodOverview(
  db: DbClient,
  restaurantId: string,
): Promise<PeriodOverview> {
  const recent = await listPeriods(db, restaurantId, 4);
  const openItem = recent.find((p) => p.status === 'OPEN');
  if (!openItem) return { open: null, recent };
  const [tips, withHours, activePeople] = await Promise.all([
    db.tipEntry.aggregate({
      where: {
        dailyDistribution: {
          restaurantId,
          status: 'DRAFT',
          dateFrom: dateOf(openItem.weekStart),
          dateTo: dateOf(openItem.weekEnd),
        },
      },
      _sum: { amountArsCents: true },
    }),
    db.periodHours.count({
      where: { restaurantId, settlementId: openItem.settlementId, employee: { active: true } },
    }),
    db.employee.count({ where: { restaurantId, active: true, archivedAt: null } }),
  ]);
  return {
    open: {
      settlementId: openItem.settlementId,
      weekStart: openItem.weekStart,
      weekEnd: openItem.weekEnd,
      tipsCents: (tips._sum.amountArsCents ?? 0n).toString(),
      peopleWithHours: withHours,
      activePeople,
    },
    recent: recent.filter((p) => p.status === 'CLOSED'),
  };
}

/** Detalle de un reparto cerrado (o anulado) del restaurante. null: no existe o está abierto. */
export async function getClosedPeriodView(
  db: DbClient,
  restaurantId: string,
  settlementId: string,
): Promise<ClosedPeriodView | null> {
  const settlement = await db.weeklySettlement.findFirst({
    where: { id: settlementId, restaurantId, status: { in: ['CLOSED', 'VOIDED'] } },
    select: {
      id: true,
      weekStart: true,
      weekEnd: true,
      status: true,
      closedAt: true,
      closedBy: { select: { name: true } },
      policyVersion: { select: { number: true, roundingUnit: true } },
      totalCents: true,
      totalAdvancesCents: true,
      totalFinalCents: true,
    },
  });
  if (!settlement) return null;
  const [distribution, payments, zeroHours] = await Promise.all([
    db.dailyDistribution.findFirst({
      where: { restaurantId, settlementId: settlement.id },
      select: {
        totalPoints: true,
        tipEntries: {
          select: { entryDate: true, amountArsCents: true, note: true },
          orderBy: { entryDate: 'asc' },
        },
        items: {
          orderBy: [{ amountCents: 'desc' }, { employeeNameSnapshot: 'asc' }],
          select: {
            employeeId: true,
            employeeNameSnapshot: true,
            positionNameSnapshot: true,
            portionSnapshot: true,
            hours: true,
            points: true,
            percentage: true,
            amountCents: true,
            advancesCents: true,
            finalCents: true,
          },
        },
      },
    }),
    db.weeklyPayment.findMany({
      where: { restaurantId, settlementId: settlement.id },
      select: { employeeId: true, status: true },
    }),
    db.periodHours.findMany({
      where: { restaurantId, settlementId: settlement.id, hours: 0 },
      select: { employee: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const status = new Map(payments.map((p) => [p.employeeId, p.status]));
  const items = distribution?.items ?? [];
  const entries = distribution?.tipEntries ?? [];
  const toE = (value: { toFixed(n: number): string }, scale: number) =>
    value
      .toFixed(scale)
      .replace('.', '')
      .replace(/^(-?)0+(?=\d)/, '$1');
  const totalHoursE2 = items.reduce((sum, i) => sum + BigInt(toE(i.hours, 2)), 0n);
  return {
    settlementId: settlement.id,
    weekStart: isoOf(settlement.weekStart),
    weekEnd: isoOf(settlement.weekEnd),
    status: settlement.status === 'VOIDED' ? 'VOIDED' : 'CLOSED',
    closedAt: settlement.closedAt?.toISOString() ?? null,
    closedByName: settlement.closedBy?.name ?? null,
    policyVersion: settlement.policyVersion.number,
    roundingUnit: settlement.policyVersion.roundingUnit,
    totalCents: (settlement.totalCents ?? 0n).toString(),
    totalAdvancesCents: (settlement.totalAdvancesCents ?? 0n).toString(),
    totalFinalCents: (settlement.totalFinalCents ?? 0n).toString(),
    totalPointsE6: distribution ? toE(distribution.totalPoints, 6) : '0',
    totalHours: totalHoursE2.toString(),
    tipsMode: entries.some((e) => e.note !== PERIOD_TOTAL_NOTE) ? 'daily' : 'total',
    tipsByDay: entries.map((e) => ({
      date: isoOf(e.entryDate),
      amountCents: e.amountArsCents.toString(),
    })),
    rows: items.map((i) => ({
      employeeId: i.employeeId,
      name: i.employeeNameSnapshot,
      positionName: i.positionNameSnapshot,
      hours: hoursText(i.hours.toFixed(2)),
      factor: i.portionSnapshot.toFixed(10).replace(/0+$/, '').replace(/\.$/, '').replace('.', ','),
      pointsE6: toE(i.points, 6),
      // percentage es una fracción 0..1 con 6 decimales → centésimas de punto porcentual.
      percentE2: (BigInt(toE(i.percentage, 6)) / 100n).toString(),
      amountCents: i.amountCents.toString(),
      advancesCents: i.advancesCents.toString(),
      finalCents: i.finalCents.toString(),
      paymentStatus: status.get(i.employeeId) ?? null,
    })),
    withoutHours: zeroHours.map((h) => displayName(h.employee)),
  };
}
