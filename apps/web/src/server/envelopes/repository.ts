/**
 * Lecturas de sobres. TODAS filtran por `restaurantId` y, para el rol SELF, por su empleado
 * (`employeeScope`): un sobre de otro restaurante o de otra persona no existe para esta capa.
 * Cantidad fija de consultas por pantalla (sin una consulta por sobre).
 */
import {
  type EnvelopeEventType,
  type EnvelopePeriodItem,
  type EnvelopesPeriodView,
  type EnvelopeStatus,
} from '@/lib/envelopes/view';
import { employeeScope, type AccessContext } from '../access/access';
import { CAN, canHandleEnvelopes, roleAllowed } from '../access/roles';
import type { DbClient } from '../policy/repository';

const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

/** Repartos cerrados con sus sobres (lo propio para SELF), del más nuevo al más viejo. */
export async function listEnvelopePeriods(
  db: DbClient,
  access: AccessContext,
  take = 20,
): Promise<EnvelopePeriodItem[]> {
  const scope = employeeScope(access);
  const own = scope.id !== undefined;
  const settlements = await db.weeklySettlement.findMany({
    where: {
      restaurantId: scope.restaurantId,
      status: 'CLOSED',
      ...(own ? { payments: { some: { employeeId: scope.id } } } : {}),
    },
    orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }],
    take,
    select: { id: true, weekStart: true, weekEnd: true },
  });
  if (settlements.length === 0) return [];
  const groups = await db.weeklyPayment.groupBy({
    by: ['settlementId', 'status'],
    where: {
      restaurantId: scope.restaurantId,
      settlementId: { in: settlements.map((s) => s.id) },
      netCents: { gt: 0 },
      ...(own ? { employeeId: scope.id } : {}),
    },
    _count: { _all: true },
    _sum: { netCents: true },
  });
  return settlements.map((s) => {
    const mine = groups.filter((g) => g.settlementId === s.id);
    const count = (status: EnvelopeStatus) =>
      mine.find((g) => g.status === status)?._count._all ?? 0;
    const sum = (statuses: EnvelopeStatus[]) =>
      mine
        .filter((g) => statuses.includes(g.status))
        .reduce((total, g) => total + (g._sum.netCents ?? 0n), 0n);
    return {
      settlementId: s.id,
      weekStart: isoOf(s.weekStart),
      weekEnd: isoOf(s.weekEnd),
      total: count('PENDING') + count('PREPARED') + count('DELIVERED'),
      pending: count('PENDING'),
      prepared: count('PREPARED'),
      delivered: count('DELIVERED'),
      toDeliverCents: sum(['PENDING', 'PREPARED']).toString(),
      deliveredCents: sum(['DELIVERED']).toString(),
    };
  });
}

/** Sobres de un reparto cerrado (o anulado) del restaurante. null: no existe, es ajeno o está abierto. */
export async function getEnvelopesView(
  db: DbClient,
  access: AccessContext,
  settlementId: string,
): Promise<EnvelopesPeriodView | null> {
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
      policyVersion: { select: { envelopeHandlers: true } },
    },
  });
  if (!settlement) return null;
  const paymentWhere = {
    restaurantId: scope.restaurantId,
    settlementId: settlement.id,
    ...(own ? { employeeId: scope.id } : {}),
  };
  const [payments, items, events] = await Promise.all([
    db.weeklyPayment.findMany({
      where: paymentWhere,
      orderBy: [{ netCents: 'desc' }, { employeeNameSnapshot: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        employeeNameSnapshot: true,
        grossCents: true,
        advancesCents: true,
        netCents: true,
        status: true,
        preparedAt: true,
        preparedBy: { select: { name: true } },
        deliveredAt: true,
        deliveredBy: { select: { name: true } },
        deliveryNote: true,
      },
    }),
    db.dailyDistributionItem.findMany({
      where: {
        dailyDistribution: { restaurantId: scope.restaurantId, settlementId: settlement.id },
        ...(own ? { employeeId: scope.id } : {}),
      },
      select: { employeeId: true, positionNameSnapshot: true },
    }),
    db.weeklyPaymentEvent.findMany({
      where: { restaurantId: scope.restaurantId, payment: paymentWhere },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        paymentId: true,
        eventType: true,
        occurredAt: true,
        amountCents: true,
        reason: true,
        performedBy: { select: { name: true } },
      },
    }),
  ]);
  const positions = new Map(items.map((i) => [i.employeeId, i.positionNameSnapshot]));
  const handlers = settlement.policyVersion.envelopeHandlers;
  const closed = settlement.status === 'CLOSED';
  return {
    settlementId: settlement.id,
    weekStart: isoOf(settlement.weekStart),
    weekEnd: isoOf(settlement.weekEnd),
    status: closed ? 'CLOSED' : 'VOIDED',
    ownOnly: own,
    canHandle: closed && canHandleEnvelopes(access.role, handlers),
    canRevert: closed && roleAllowed(access.role, CAN.revertDelivery),
    envelopes: payments.map((p) => ({
      paymentId: p.id,
      employeeId: p.employeeId,
      name: p.employeeNameSnapshot,
      positionName: positions.get(p.employeeId) ?? null,
      grossCents: p.grossCents.toString(),
      advancesCents: p.advancesCents.toString(),
      netCents: p.netCents.toString(),
      status: p.status,
      preparedAt: p.preparedAt?.toISOString() ?? null,
      preparedBy: p.preparedBy?.name ?? null,
      deliveredAt: p.deliveredAt?.toISOString() ?? null,
      deliveredBy: p.deliveredBy?.name ?? null,
      deliveryNote: p.deliveryNote,
      events: events
        .filter((e) => e.paymentId === p.id)
        .map((e) => ({
          type: e.eventType as EnvelopeEventType,
          at: e.occurredAt.toISOString(),
          by: e.performedBy.name,
          amountCents: e.amountCents.toString(),
          reason: e.reason,
        })),
    })),
  };
}
