/**
 * Sobres (weekly_payments) sobre un contexto YA autorizado por `requireAccess`.
 *
 * Reglas (DATABASE.md §4.6 y §6, las mismas que la demo):
 *   PENDING → PREPARED → DELIVERED        cada paso con quién y cuándo (hora del servidor)
 *   PREPARED → PENDING                    deshacer la preparación: motivo obligatorio
 *   DELIVERED → PREPARED                  revertir la entrega: motivo, solo Dueño/Encargado,
 *                                         evento DELIVERY_REVERTED (authorized_by) + audit_log
 * Cada cambio agrega un evento en `weekly_payment_events` (solo inserción). Los importes de un
 * sobre NUNCA se calculan acá: son los del reparto cerrado (`daily_distribution_items`) y la base
 * los congela (trigger `fn_weekly_payments_guard`). Solo se opera sobre repartos CLOSED: uno
 * abierto todavía no tiene sobres y uno anulado (VOIDED) queda congelado.
 *
 * Concurrencia: cada operación bloquea las filas que cambia (`FOR UPDATE`) y vuelve a leer su
 * estado ya bloqueado; dos personas que preparan o entregan lo mismo a la vez se ordenan y la
 * segunda ve el estado nuevo (no hay dobles eventos ni estados imposibles).
 */
import type { PrismaClient } from '@prisma/client';
import { AccessDenied, assertRole, type AccessContext } from '../access/access';
import { CAN, canHandleEnvelopes } from '../access/roles';
import type { DbClient } from '../policy/repository';
import { TX_OPTIONS, type ServiceResult } from '../policy/service';
import type {
  DeliverEnvelopeInput,
  PrepareEnvelopesInput,
  RevertDeliveryInput,
  UndoPreparationInput,
} from './schemas';

const fail = <T>(error: string): ServiceResult<T> => ({ ok: false, error });

const PERIOD_NOT_FOUND = 'No se encontró ese reparto.';
const PERIOD_OPEN = 'Este reparto todavía no está cerrado: los sobres se generan al cerrarlo.';
const PERIOD_VOIDED = 'Este reparto fue anulado: sus sobres no se pueden modificar.';
const ENVELOPE_NOT_FOUND = 'No se encontró ese sobre.';
const NO_AMOUNT = 'Este sobre no tiene importe para entregar (los adelantos se llevaron todo).';

type Handlers = 'MANAGER_ONLY' | 'MANAGER_AND_EDITOR';

interface LockedPeriod {
  id: string;
  status: string;
  weekStart: string;
  weekEnd: string;
  envelopeHandlers: Handlers;
}

/** Bloquea el período del restaurante (null si no existe o es de otro restaurante). */
async function lockPeriod(
  tx: DbClient,
  restaurantId: string,
  settlementId: string,
): Promise<LockedPeriod | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      week_start: string;
      week_end: string;
      envelope_handlers: Handlers;
    }[]
  >`
    SELECT s.id::text AS id, s.status::text AS status, s.week_start::text AS week_start,
           s.week_end::text AS week_end, v.envelope_handlers::text AS envelope_handlers
    FROM weekly_settlements s
    JOIN distribution_policy_versions v ON v.id = s.policy_version_id
    WHERE s.id = ${settlementId}::uuid AND s.restaurant_id = ${restaurantId}::uuid
    FOR UPDATE OF s`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    envelopeHandlers: row.envelope_handlers,
  };
}

function periodError(period: LockedPeriod | null): string | null {
  if (!period) return PERIOD_NOT_FOUND;
  if (period.status === 'OPEN') return PERIOD_OPEN;
  if (period.status !== 'CLOSED') return PERIOD_VOIDED;
  return null;
}

/** Defensa en profundidad: el rol tiene que alcanzar según la política del período. */
function assertCanHandle(access: AccessContext, handlers: Handlers): void {
  if (!canHandleEnvelopes(access.role, handlers)) throw new AccessDenied('FORBIDDEN');
}

const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/**
 * Asegura que el reparto cerrado tenga un sobre por persona con propina (> 0), tomando los
 * importes del reparto cerrado. Idempotente: solo crea los que faltan (el cierre ya los crea; esto
 * cubre un cierre anterior a los sobres). Nunca recalcula nada.
 */
async function ensureEnvelopesInTx(
  tx: DbClient,
  access: AccessContext,
  period: LockedPeriod,
): Promise<number> {
  const [items, existing] = await Promise.all([
    tx.dailyDistributionItem.findMany({
      where: {
        dailyDistribution: {
          restaurantId: access.restaurantId,
          settlementId: period.id,
          status: 'CLOSED',
        },
        amountCents: { gt: 0 },
      },
      select: {
        employeeId: true,
        employeeNameSnapshot: true,
        amountCents: true,
        advancesCents: true,
        finalCents: true,
      },
    }),
    tx.weeklyPayment.findMany({
      where: { restaurantId: access.restaurantId, settlementId: period.id },
      select: { employeeId: true },
    }),
  ]);
  const has = new Set(existing.map((p) => p.employeeId));
  const missing = items.filter((i) => !has.has(i.employeeId));
  if (missing.length === 0) return 0;
  const created = await tx.weeklyPayment.createManyAndReturn({
    data: missing.map((i) => ({
      restaurantId: access.restaurantId,
      settlementId: period.id,
      employeeId: i.employeeId,
      employeeNameSnapshot: i.employeeNameSnapshot,
      periodStart: dateOf(period.weekStart),
      periodEnd: dateOf(period.weekEnd),
      grossCents: i.amountCents,
      advancesCents: i.advancesCents,
      netCents: i.finalCents,
    })),
    select: { id: true, netCents: true },
  });
  await tx.weeklyPaymentEvent.createMany({
    data: created.map((p) => ({
      restaurantId: access.restaurantId,
      paymentId: p.id,
      eventType: 'CREATED' as const,
      toStatus: 'PENDING' as const,
      amountCents: p.netCents,
      performedById: access.userId,
    })),
  });
  return created.length;
}

// ─────────────────────────── Preparar ───────────────────────────

/**
 * Prepara los sobres PENDIENTES con importe del reparto (todos, o los indicados). Idempotente:
 * los que ya están preparados o entregados no se tocan ni generan eventos.
 */
export async function prepareEnvelopes(
  db: PrismaClient,
  access: AccessContext,
  input: PrepareEnvelopesInput,
): Promise<ServiceResult<{ prepared: number; created: number }>> {
  assertRole(access, CAN.handleEnvelopes);
  return db.$transaction(async (tx) => {
    const period = await lockPeriod(tx, access.restaurantId, input.settlementId);
    const error = periodError(period);
    if (error || !period) return fail(error ?? PERIOD_NOT_FOUND);
    assertCanHandle(access, period.envelopeHandlers);

    const created = await ensureEnvelopesInTx(tx, access, period);
    const ids = input.paymentIds ?? null;
    const rows = await tx.$queryRaw<{ id: string; status: string; net_cents: bigint }[]>`
      SELECT id::text AS id, status::text AS status, net_cents
      FROM weekly_payments
      WHERE restaurant_id = ${access.restaurantId}::uuid AND settlement_id = ${period.id}::uuid
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
      ORDER BY id
      FOR UPDATE`;
    if (ids && rows.length !== new Set(ids).size) return fail(ENVELOPE_NOT_FOUND);
    if (ids && rows.length === 1) {
      const only = rows[0];
      if (only && only.net_cents === 0n) return fail(NO_AMOUNT);
      if (only && only.status !== 'PENDING') return fail('Ese sobre ya está preparado.');
    }
    const targets = rows.filter((r) => r.status === 'PENDING' && r.net_cents > 0n);
    if (targets.length > 0) {
      const now = new Date();
      await tx.weeklyPayment.updateMany({
        where: { id: { in: targets.map((t) => t.id) }, status: 'PENDING' },
        data: { status: 'PREPARED', preparedAt: now, preparedById: access.userId },
      });
      await tx.weeklyPaymentEvent.createMany({
        data: targets.map((t) => ({
          restaurantId: access.restaurantId,
          paymentId: t.id,
          eventType: 'PREPARED' as const,
          fromStatus: 'PENDING' as const,
          toStatus: 'PREPARED' as const,
          amountCents: t.net_cents,
          performedById: access.userId,
          occurredAt: now,
        })),
      });
    }
    return { ok: true, value: { prepared: targets.length, created } };
  }, TX_OPTIONS);
}

// ─────────────────────── Operaciones sobre un sobre ───────────────────────

interface LockedEnvelope {
  id: string;
  status: string;
  netCents: bigint;
  settlementStatus: string;
  envelopeHandlers: Handlers;
}

/**
 * Bloquea un sobre del restaurante. Orden de bloqueo único para evitar deadlocks: primero el
 * reparto (`FOR SHARE`: dos entregas distintas conviven; "Preparar todos", que lo toma `FOR
 * UPDATE`, las ordena) y después el sobre (`FOR UPDATE`). Con el reparto compartido, una anulación
 * del reparto (que exige que no haya entregas) espera a esta operación y ve el estado nuevo.
 */
async function lockEnvelope(
  tx: DbClient,
  restaurantId: string,
  paymentId: string,
): Promise<LockedEnvelope | null> {
  const owner = await tx.weeklyPayment.findFirst({
    where: { id: paymentId, restaurantId },
    select: { settlementId: true },
  });
  if (!owner) return null;
  const settlements = await tx.$queryRaw<{ status: string; envelope_handlers: Handlers }[]>`
    SELECT s.status::text AS status, v.envelope_handlers::text AS envelope_handlers
    FROM weekly_settlements s
    JOIN distribution_policy_versions v ON v.id = s.policy_version_id
    WHERE s.id = ${owner.settlementId}::uuid AND s.restaurant_id = ${restaurantId}::uuid
    FOR SHARE OF s`;
  const settlement = settlements[0];
  if (!settlement) return null;
  const rows = await tx.$queryRaw<{ id: string; status: string; net_cents: bigint }[]>`
    SELECT id::text AS id, status::text AS status, net_cents
    FROM weekly_payments
    WHERE id = ${paymentId}::uuid AND restaurant_id = ${restaurantId}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    netCents: row.net_cents,
    settlementStatus: settlement.status,
    envelopeHandlers: settlement.envelope_handlers,
  };
}

function envelopeError(envelope: LockedEnvelope | null): string | null {
  if (!envelope) return ENVELOPE_NOT_FOUND;
  if (envelope.settlementStatus !== 'CLOSED' || envelope.status === 'VOIDED') return PERIOD_VOIDED;
  return null;
}

/** Deshacer la preparación (PREPARED → PENDING), con motivo. */
export async function undoPreparation(
  db: PrismaClient,
  access: AccessContext,
  input: UndoPreparationInput,
): Promise<ServiceResult<{ paymentId: string }>> {
  assertRole(access, CAN.handleEnvelopes);
  return db.$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, access.restaurantId, input.paymentId);
    const error = envelopeError(envelope);
    if (error || !envelope) return fail(error ?? ENVELOPE_NOT_FOUND);
    assertCanHandle(access, envelope.envelopeHandlers);
    if (envelope.status !== 'PREPARED') {
      return fail('Solo se puede deshacer la preparación de un sobre preparado.');
    }
    await tx.weeklyPayment.update({
      where: { id: envelope.id },
      data: { status: 'PENDING', preparedAt: null, preparedById: null },
    });
    await tx.weeklyPaymentEvent.create({
      data: {
        restaurantId: access.restaurantId,
        paymentId: envelope.id,
        eventType: 'PREPARATION_UNDONE',
        fromStatus: 'PREPARED',
        toStatus: 'PENDING',
        amountCents: envelope.netCents,
        performedById: access.userId,
        reason: input.reason,
      },
    });
    return { ok: true, value: { paymentId: envelope.id } };
  }, TX_OPTIONS);
}

/** Entregar un sobre preparado (PREPARED → DELIVERED): quién y cuándo los fija el servidor. */
export async function deliverEnvelope(
  db: PrismaClient,
  access: AccessContext,
  input: DeliverEnvelopeInput,
): Promise<ServiceResult<{ paymentId: string }>> {
  assertRole(access, CAN.handleEnvelopes);
  return db.$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, access.restaurantId, input.paymentId);
    const error = envelopeError(envelope);
    if (error || !envelope) return fail(error ?? ENVELOPE_NOT_FOUND);
    assertCanHandle(access, envelope.envelopeHandlers);
    if (envelope.status === 'DELIVERED') return fail('Ese sobre ya fue entregado.');
    if (envelope.status !== 'PREPARED') return fail('Primero hay que preparar el sobre.');
    if (envelope.netCents === 0n) return fail(NO_AMOUNT);
    const now = new Date();
    await tx.weeklyPayment.update({
      where: { id: envelope.id },
      data: {
        status: 'DELIVERED',
        deliveredAt: now,
        deliveredById: access.userId,
        deliveryNote: input.note === '' ? null : input.note,
      },
    });
    await tx.weeklyPaymentEvent.create({
      data: {
        restaurantId: access.restaurantId,
        paymentId: envelope.id,
        eventType: 'DELIVERED',
        fromStatus: 'PREPARED',
        toStatus: 'DELIVERED',
        amountCents: envelope.netCents,
        performedById: access.userId,
        occurredAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        restaurantId: access.restaurantId,
        userId: access.userId,
        action: 'envelope.delivered',
        entity: 'weekly_payments',
        entityId: envelope.id,
        payload: { amountCents: envelope.netCents.toString() },
      },
    });
    return { ok: true, value: { paymentId: envelope.id } };
  }, TX_OPTIONS);
}

/**
 * Revertir una entrega (DELIVERED → PREPARED): solo Dueño/Encargado, motivo obligatorio. Se
 * limpian los datos de la entrega en la fila; el evento DELIVERED original queda en la bitácora.
 */
export async function revertDelivery(
  db: PrismaClient,
  access: AccessContext,
  input: RevertDeliveryInput,
): Promise<ServiceResult<{ paymentId: string }>> {
  assertRole(access, CAN.revertDelivery);
  return db.$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, access.restaurantId, input.paymentId);
    const error = envelopeError(envelope);
    if (error || !envelope) return fail(error ?? ENVELOPE_NOT_FOUND);
    if (envelope.status !== 'DELIVERED') {
      return fail('Solo se puede revertir la entrega de un sobre entregado.');
    }
    await tx.weeklyPayment.update({
      where: { id: envelope.id },
      data: { status: 'PREPARED', deliveredAt: null, deliveredById: null, deliveryNote: null },
    });
    await tx.weeklyPaymentEvent.create({
      data: {
        restaurantId: access.restaurantId,
        paymentId: envelope.id,
        eventType: 'DELIVERY_REVERTED',
        fromStatus: 'DELIVERED',
        toStatus: 'PREPARED',
        amountCents: envelope.netCents,
        performedById: access.userId,
        // La autorización es por rol (A3): quien revierte es Dueño/Encargado y autoriza.
        authorizedById: access.userId,
        reason: input.reason,
      },
    });
    await tx.auditLog.create({
      data: {
        restaurantId: access.restaurantId,
        userId: access.userId,
        action: 'envelope.delivery_reverted',
        entity: 'weekly_payments',
        entityId: envelope.id,
        payload: { amountCents: envelope.netCents.toString(), reason: input.reason },
      },
    });
    return { ok: true, value: { paymentId: envelope.id } };
  }, TX_OPTIONS);
}
