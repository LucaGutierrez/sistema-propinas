/**
 * Historial: SOLO LECTURA. Todo filtra por el restaurante resuelto en el servidor y, para el rol
 * SELF, por su empleado (`employeeScope`); SELF nunca recibe totales ni datos de otras personas.
 *
 * Fuente de verdad: lo que quedó guardado al cerrar cada reparto —`daily_distribution_items`
 * (horas, porción, puntos, porcentaje e importes de cada persona), `weekly_settlements` (totales,
 * snapshot de la política, quién cerró/anuló), `weekly_payments` + `weekly_payment_events`
 * (sobres y su historia) y `advances` + `advance_applications`. Nunca se llama al motor de
 * cálculo ni se lee la configuración actual: un reparto viejo se ve exactamente como se cerró.
 *
 * Cantidad fija de consultas por pantalla (sin una por fila).
 */
import type { Prisma } from '@prisma/client';
import type { EnvelopeEventType, EnvelopeStatus } from '@/lib/envelopes/view';
import { divRoundHalfUp } from '@/lib/decimal';
import { HISTORY_PAGE_SIZE } from '@/lib/history/filters';
import { hoursText } from '@/lib/distribution/period-view';
import type {
  HistoryAdvance,
  HistoryDetail,
  HistoryEvent,
  HistoryFilters,
  HistoryList,
  HistoryPersonRow,
} from '@/lib/history/view';
import { employeeScope, type AccessContext } from '../access/access';
import { CAN, roleAllowed } from '../access/roles';
import type { DbClient } from '../policy/repository';
import { displayName } from '../staff/repository';

const isoOf = (date: Date): string => date.toISOString().slice(0, 10);
/** uuid que no existe: filtra "ninguno" sin romper el tipo uuid de la columna. */
const NO_DISTRIBUTION = '00000000-0000-0000-0000-000000000000';
const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Decimal de la base → entero escalado en texto ("0.630000" con escala 6 → "630000"). */
const scaled = (value: { toFixed(n: number): string }, scale: number): string =>
  value
    .toFixed(scale)
    .replace('.', '')
    .replace(/^(-?)0+(?=\d)/, '$1');

/** Porción guardada (NUMERIC(20,10)) → "0,014". */
const portionText = (value: { toFixed(n: number): string }): string =>
  value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');

// ───────────────────────────── Lista ─────────────────────────────

export async function listHistory(
  db: DbClient,
  access: AccessContext,
  filters: HistoryFilters,
): Promise<HistoryList> {
  const scope = employeeScope(access);
  const own = scope.id !== undefined;
  const where: Prisma.WeeklySettlementWhereInput = {
    restaurantId: scope.restaurantId,
    status: filters.status ?? { in: ['CLOSED', 'VOIDED'] },
    ...(filters.from || filters.to
      ? {
          weekStart: {
            ...(filters.from ? { gte: dateOf(filters.from) } : {}),
            ...(filters.to ? { lte: dateOf(filters.to) } : {}),
          },
        }
      : {}),
  };
  // SELF: solo los repartos donde tuvo sobre; nadie más puede buscarse.
  const paymentFilter: Prisma.WeeklyPaymentWhereInput | null = own
    ? { employeeId: scope.id }
    : filters.employee
      ? { employeeNameSnapshot: { contains: filters.employee, mode: 'insensitive' } }
      : null;
  if (paymentFilter) where.payments = { some: paymentFilter };

  const rows = await db.weeklySettlement.findMany({
    where,
    orderBy: [{ weekStart: 'desc' }, { revision: 'desc' }, { createdAt: 'desc' }],
    skip: (filters.page - 1) * HISTORY_PAGE_SIZE,
    take: HISTORY_PAGE_SIZE + 1,
    select: {
      id: true,
      weekStart: true,
      weekEnd: true,
      status: true,
      closedAt: true,
      closedBy: { select: { name: true } },
      voidedAt: true,
      totalCents: true,
    },
  });
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  if (page.length === 0) return { items: [], ownOnly: own, hasMore: false };

  const groups = await db.weeklyPayment.groupBy({
    by: ['settlementId', 'status'],
    where: {
      restaurantId: scope.restaurantId,
      settlementId: { in: page.map((s) => s.id) },
      ...(own ? { employeeId: scope.id } : {}),
    },
    _count: { _all: true },
    _sum: { netCents: true, grossCents: true },
  });

  return {
    ownOnly: own,
    hasMore: rows.length > HISTORY_PAGE_SIZE,
    items: page.map((s) => {
      const mine = groups.filter((g) => g.settlementId === s.id);
      const count = (statuses: EnvelopeStatus[]) =>
        mine.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
      const toDeliver = mine
        .filter((g) => g.status === 'PENDING' || g.status === 'PREPARED')
        .reduce((sum, g) => sum + (g._sum.netCents ?? 0n), 0n);
      const ownGross = mine.reduce((sum, g) => sum + (g._sum.grossCents ?? 0n), 0n);
      return {
        settlementId: s.id,
        weekStart: isoOf(s.weekStart),
        weekEnd: isoOf(s.weekEnd),
        status: s.status === 'VOIDED' ? 'VOIDED' : 'CLOSED',
        closedAt: s.closedAt?.toISOString() ?? null,
        closedBy: s.closedBy?.name ?? null,
        voidedAt: s.voidedAt?.toISOString() ?? null,
        totalCents: (own ? ownGross : (s.totalCents ?? 0n)).toString(),
        participants: own ? null : count(['PENDING', 'PREPARED', 'DELIVERED', 'VOIDED']),
        envelopes: count(['PENDING', 'PREPARED', 'DELIVERED']),
        delivered: count(['DELIVERED']),
        toDeliverCents: toDeliver.toString(),
      };
    }),
  };
}

// ──────────────────────────── Detalle ────────────────────────────

const itemSelect = {
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
} satisfies Prisma.DailyDistributionItemSelect;

/** Número de versión y redondeo guardados en el snapshot del cierre (no la política actual). */
function snapshotInfo(snapshot: Prisma.JsonValue | null): {
  number: number | null;
  rounding: 'CENT' | 'PESO' | null;
} {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { number: null, rounding: null };
  }
  const number = typeof snapshot.number === 'number' ? snapshot.number : null;
  const rounding =
    snapshot.roundingUnit === 'CENT' || snapshot.roundingUnit === 'PESO'
      ? snapshot.roundingUnit
      : null;
  return { number, rounding };
}

/** Detalle de un reparto cerrado o anulado del restaurante. null: no existe, es ajeno o está abierto. */
export async function getHistoryDetail(
  db: DbClient,
  access: AccessContext,
  settlementId: string,
): Promise<HistoryDetail | null> {
  const scope = employeeScope(access);
  const own = scope.id !== undefined;
  const settlement = await db.weeklySettlement.findFirst({
    where: {
      id: settlementId,
      restaurantId: scope.restaurantId,
      status: { in: ['CLOSED', 'VOIDED'] },
    },
    select: {
      id: true,
      weekStart: true,
      weekEnd: true,
      status: true,
      closedAt: true,
      closedBy: { select: { name: true } },
      voidedAt: true,
      voidedBy: { select: { name: true } },
      voidReason: true,
      policySnapshot: true,
      calcVersion: true,
      supersedesSettlementId: true,
      supersededBy: { select: { id: true, status: true } },
      totalCents: true,
      totalAdvancesCents: true,
      totalFinalCents: true,
    },
  });
  if (!settlement) return null;

  const mineOnly = own ? { employeeId: scope.id } : {};
  const paymentWhere: Prisma.WeeklyPaymentWhereInput = {
    restaurantId: scope.restaurantId,
    settlementId: settlement.id,
    ...mineOnly,
  };
  const [linked, payments, events] = await Promise.all([
    db.dailyDistribution.findFirst({
      where: { restaurantId: scope.restaurantId, settlementId: settlement.id },
      select: { id: true, totalPoints: true, items: { where: mineOnly, select: itemSelect } },
    }),
    db.weeklyPayment.findMany({
      where: paymentWhere,
      orderBy: [{ netCents: 'desc' }, { employeeNameSnapshot: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        employeeNameSnapshot: true,
        status: true,
        grossCents: true,
        advancesCents: true,
        netCents: true,
      },
    }),
    db.weeklyPaymentEvent.findMany({
      where: {
        restaurantId: scope.restaurantId,
        payment: paymentWhere,
        eventType: { not: 'CREATED' },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        paymentId: true,
        eventType: true,
        occurredAt: true,
        amountCents: true,
        reason: true,
        performedBy: { select: { name: true } },
        payment: { select: { employeeNameSnapshot: true } },
      },
    }),
  ]);

  // Al anular un reparto, su reparto diario se desvincula (DATABASE.md §6): se busca por fechas
  // el que se había cerrado antes de la anulación.
  const distribution =
    linked ??
    (settlement.status === 'VOIDED'
      ? await db.dailyDistribution.findFirst({
          where: {
            restaurantId: scope.restaurantId,
            settlementId: null,
            scope: 'PERIOD',
            dateFrom: settlement.weekStart,
            dateTo: settlement.weekEnd,
            status: { in: ['CLOSED', 'VOIDED'] },
            ...(settlement.voidedAt ? { closedAt: { lte: settlement.voidedAt } } : {}),
          },
          orderBy: { closedAt: 'desc' },
          select: { id: true, totalPoints: true, items: { where: mineOnly, select: itemSelect } },
        })
      : null);

  const advances = await db.advance.findMany({
    where: {
      restaurantId: scope.restaurantId,
      ...mineOnly,
      OR: [
        { date: { gte: settlement.weekStart, lte: settlement.weekEnd } },
        ...(distribution
          ? [{ applications: { some: { item: { dailyDistributionId: distribution.id } } } }]
          : []),
      ],
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      date: true,
      note: true,
      amountCents: true,
      appliedCents: true,
      status: true,
      employee: { select: { firstName: true, lastName: true } },
      applications: {
        // Solo los descuentos hechos en ESTE reparto (sin reparto: ninguno).
        where: { item: { dailyDistributionId: distribution?.id ?? NO_DISTRIBUTION } },
        select: { amountCents: true, revertedAt: true },
      },
    },
  });

  // SELF que no participó de este reparto: para esa persona no existe (no se revela nada).
  if (own && payments.length === 0 && (distribution?.items.length ?? 0) === 0) return null;

  const paymentOf = new Map(payments.map((p) => [p.employeeId, p]));
  const reverted = new Set(
    events.filter((e) => e.eventType === 'DELIVERY_REVERTED').map((e) => e.paymentId),
  );
  const envelopeOf = (employeeId: string): HistoryPersonRow['envelope'] => {
    const payment = paymentOf.get(employeeId);
    return payment
      ? { paymentId: payment.id, status: payment.status, reverted: reverted.has(payment.id) }
      : null;
  };

  const items = distribution?.items ?? [];
  const people: HistoryPersonRow[] =
    items.length > 0
      ? [...items]
          .sort((a, b) =>
            a.amountCents === b.amountCents
              ? a.employeeNameSnapshot.localeCompare(b.employeeNameSnapshot)
              : a.amountCents > b.amountCents
                ? -1
                : 1,
          )
          .map((i) => ({
            employeeId: i.employeeId,
            name: i.employeeNameSnapshot,
            positionName: i.positionNameSnapshot,
            hours: hoursText(i.hours.toFixed(2)),
            factor: portionText(i.portionSnapshot),
            pointsE6: scaled(i.points, 6),
            // La fracción guardada (0..1, 6 decimales) → centésimas de punto porcentual.
            percentE2: divRoundHalfUp(BigInt(scaled(i.percentage, 6)), 100n).toString(),
            grossCents: i.amountCents.toString(),
            advancesCents: i.advancesCents.toString(),
            finalCents: i.finalCents.toString(),
            envelope: envelopeOf(i.employeeId),
          }))
      : // Sin ítems (reparto anulado viejo): lo que guardan los sobres.
        payments.map((p) => ({
          employeeId: p.employeeId,
          name: p.employeeNameSnapshot,
          positionName: '—',
          hours: '—',
          factor: '—',
          pointsE6: '',
          percentE2: '',
          grossCents: p.grossCents.toString(),
          advancesCents: p.advancesCents.toString(),
          finalCents: p.netCents.toString(),
          envelope: envelopeOf(p.employeeId),
        }));

  const historyAdvances: HistoryAdvance[] = advances.map((a) => ({
    advanceId: a.id,
    employeeName: displayName(a.employee),
    date: isoOf(a.date),
    note: a.note,
    amountCents: a.amountCents.toString(),
    appliedHereCents: a.applications.reduce((sum, x) => sum + x.amountCents, 0n).toString(),
    pendingNowCents: (a.status === 'VOIDED' ? 0n : a.amountCents - a.appliedCents).toString(),
    status: a.status,
    reverted: a.applications.some((x) => x.revertedAt !== null),
  }));

  const timeline: HistoryEvent[] = [
    ...(settlement.closedAt
      ? [
          {
            kind: 'CLOSED' as const,
            at: settlement.closedAt.toISOString(),
            by: settlement.closedBy?.name ?? '—',
            employeeName: null,
            amountCents: own ? null : (settlement.totalCents?.toString() ?? null),
            reason: null,
          },
        ]
      : []),
    ...events.map((e) => ({
      kind: e.eventType as EnvelopeEventType,
      at: e.occurredAt.toISOString(),
      by: e.performedBy.name,
      employeeName: e.payment.employeeNameSnapshot,
      amountCents: e.amountCents.toString(),
      reason: e.reason,
    })),
    ...(settlement.voidedAt
      ? [
          {
            kind: 'VOIDED' as const,
            at: settlement.voidedAt.toISOString(),
            by: settlement.voidedBy?.name ?? '—',
            employeeName: null,
            amountCents: null,
            reason: settlement.voidReason,
          },
        ]
      : []),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const info = snapshotInfo(settlement.policySnapshot);
  return {
    settlementId: settlement.id,
    weekStart: isoOf(settlement.weekStart),
    weekEnd: isoOf(settlement.weekEnd),
    status: settlement.status === 'VOIDED' ? 'VOIDED' : 'CLOSED',
    ownOnly: own,
    closedAt: settlement.closedAt?.toISOString() ?? null,
    closedBy: settlement.closedBy?.name ?? null,
    voidedAt: settlement.voidedAt?.toISOString() ?? null,
    voidedBy: settlement.voidedBy?.name ?? null,
    voidReason: settlement.voidReason,
    policyNumber: info.number,
    roundingUnit: info.rounding,
    calcVersion: settlement.calcVersion,
    totals: own
      ? null
      : {
          tipsCents: (settlement.totalCents ?? 0n).toString(),
          advancesCents: (settlement.totalAdvancesCents ?? 0n).toString(),
          finalCents: (settlement.totalFinalCents ?? 0n).toString(),
          pointsE6: distribution ? scaled(distribution.totalPoints, 6) : '0',
          participants: items.length > 0 ? items.length : payments.length,
        },
    detailAvailable: items.length > 0,
    supersedes: settlement.supersedesSettlementId
      ? { settlementId: settlement.supersedesSettlementId }
      : null,
    supersededBy: settlement.supersededBy
      ? { settlementId: settlement.supersededBy.id, status: settlement.supersededBy.status }
      : null,
    deliveredEnvelopes: own ? 0 : payments.filter((p) => p.status === 'DELIVERED').length,
    canVoid: settlement.status === 'CLOSED' && roleAllowed(access.role, CAN.voidPeriod),
    canRedo:
      settlement.status === 'VOIDED' &&
      !settlement.supersededBy &&
      roleAllowed(access.role, CAN.voidPeriod),
    people,
    advances: historyAdvances,
    events: timeline,
  };
}
