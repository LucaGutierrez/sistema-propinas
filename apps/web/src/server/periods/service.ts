/**
 * Escrituras del reparto (período) sobre un contexto YA autorizado por `requireAccess`.
 *
 * Modelo (DATABASE.md §4.4–§4.6, sin tablas nuevas):
 *   weekly_settlements (OPEN)            el período, fijado a la versión vigente de la política
 *   daily_distributions (PERIOD, DRAFT)  el reparto del período; sus tip_entries son la propina
 *   period_hours                         horas totales de cada persona (sin fila = sin cargar)
 *   advances                             adelantos (se descuentan al cerrar, del más viejo)
 * Al cerrar, en UNA transacción: ítems por persona (snapshot de nombre, puesto, porción, horas,
 * puntos e importes), aplicación de adelantos, reparto CLOSED ligado al período, sobres PENDING
 * con su evento CREATED, período CLOSED con el snapshot de la política y bitácora. Después de eso
 * los triggers de la base impiden cambiar horas, propina o importes: corregir es anular y rehacer.
 *
 * Cada operación bloquea el período (`FOR UPDATE`): una carga de horas y un cierre simultáneos se
 * ordenan, y el cierre calcula con lo último que quedó guardado.
 */
import type { PrismaClient } from '@prisma/client';
import { addDays, formatShortDate, periodStartOf, todayInTimeZone } from '@/lib/dates';
import { buildPeriodPreview } from '@/lib/distribution/period-preview';
import { PERIOD_TOTAL_NOTE } from '@/lib/distribution/period-view';
import {
  INDIVIDUAL_POINTS_SCALE,
  methodUses,
  WEIGHT_SCALE,
  type ParticipationMethod,
} from '@/lib/distribution/participation';
import { FORMULA_STATUS } from '@/lib/distribution/provisional-formula';
import { stagesToView } from '@/lib/distribution/sector-snapshot';
import { formatScaled } from '@/lib/decimal';
import { assertRole, type AccessContext } from '../access/access';
import { CAN, roleAllowed } from '../access/roles';
import { getPolicyVersion, type DbClient } from '../policy/repository';
import { TX_OPTIONS, type ServiceResult } from '../policy/service';
import { dateOf, isoOf, loadPeriodData, type PeriodRow } from './repository';
import type {
  AddAdvanceInput,
  ClosePeriodInput,
  RedoPeriodInput,
  SetHoursInput,
  SetTipsInput,
  StartPeriodInput,
  VoidAdvanceInput,
  VoidPeriodInput,
} from './schemas';

/**
 * Versión del cálculo que queda registrada en cada cierre. `provisional-1` es horas × porción
 * (BY_POSITION): el motor de participación da exactamente los mismos importes, así que esos
 * cierres siguen registrándose igual. Con puntos individuales el cálculo es otro: `provisional-2`.
 */
export const CALC_VERSION = 'provisional-1';
export const CALC_VERSION_WITH_POINTS = 'provisional-2';
/** Por sectores, en etapas (cada sector es un pozo dentro del que se aplica el método). */
export const CALC_VERSION_SECTORS = 'sectores-1';

export function calcVersionFor(method: ParticipationMethod, staged = false): string {
  if (staged) return `${CALC_VERSION_SECTORS}+${calcVersionFor(method)}`;
  return method === 'BY_POSITION' ? CALC_VERSION : CALC_VERSION_WITH_POINTS;
}

const fail = <T>(error: string): ServiceResult<T> => ({ ok: false, error });

const NOT_FOUND = 'No se encontró ese reparto.';
const CLOSED = 'Este reparto ya está cerrado: no se puede modificar.';

/** Bloquea el período del restaurante (null si no existe o es de otro restaurante). */
async function lockPeriod(
  tx: DbClient,
  restaurantId: string,
  settlementId: string,
): Promise<(PeriodRow & { status: string }) | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      week_start: string;
      week_end: string;
      policy_version_id: string;
    }[]
  >`
    SELECT id::text AS id, status::text AS status, week_start::text AS week_start,
           week_end::text AS week_end, policy_version_id::text AS policy_version_id
    FROM weekly_settlements
    WHERE id = ${settlementId}::uuid AND restaurant_id = ${restaurantId}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    policyVersionId: row.policy_version_id,
  };
}

/** Período abierto y bloqueado, o el error para mostrar. */
async function openPeriod(
  tx: DbClient,
  restaurantId: string,
  settlementId: string,
): Promise<ServiceResult<PeriodRow>> {
  const period = await lockPeriod(tx, restaurantId, settlementId);
  if (!period) return fail(NOT_FOUND);
  if (period.status !== 'OPEN') return fail(CLOSED);
  return { ok: true, value: period };
}

async function draftDistributionId(
  tx: DbClient,
  restaurantId: string,
  period: PeriodRow,
): Promise<string | null> {
  const row = await tx.dailyDistribution.findFirst({
    where: {
      restaurantId,
      scope: 'PERIOD',
      status: 'DRAFT',
      dateFrom: dateOf(period.weekStart),
      dateTo: dateOf(period.weekEnd),
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ─────────────────────────── Empezar ───────────────────────────

export async function startPeriod(
  db: PrismaClient,
  access: AccessContext,
  input: StartPeriodInput,
): Promise<ServiceResult<{ settlementId: string; created: boolean }>> {
  assertRole(access, CAN.editPeriod);
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { timezone: string; current_policy_version_id: string | null }[]
    >`
      SELECT timezone, current_policy_version_id::text AS current_policy_version_id
      FROM restaurants WHERE id = ${access.restaurantId}::uuid FOR UPDATE`;
    const restaurant = locked[0];
    if (!restaurant) return fail('El restaurante no existe.');

    // Un reparto a la vez: si ya hay uno abierto, se sigue con ese.
    const open = await tx.weeklySettlement.findFirst({
      where: { restaurantId: access.restaurantId, status: 'OPEN' },
      orderBy: { weekStart: 'desc' },
      select: { id: true },
    });
    if (open) return { ok: true, value: { settlementId: open.id, created: false } };

    if (!restaurant.current_policy_version_id) {
      return fail('El restaurante todavía no tiene configuración de distribución.');
    }
    const policy = await getPolicyVersion(
      tx,
      access.restaurantId,
      restaurant.current_policy_version_id,
    );
    if (!policy) return fail('El restaurante todavía no tiene configuración de distribución.');

    const weekday = policy.columns.periodStartWeekday;
    const today = todayInTimeZone(restaurant.timezone);
    const currentStart = periodStartOf(today, weekday);
    const weekStart = periodStartOf(input.date ?? today, weekday);
    if (weekStart > currentStart)
      return fail('No se puede empezar un reparto de una semana futura.');
    return createPeriodInTx(tx, access, weekStart, policy.id);
  }, TX_OPTIONS);
}

/**
 * Crea el período OPEN (y su reparto en borrador) de la semana que empieza en `weekStart`, con el
 * restaurante ya bloqueado. Si esa semana tiene un reparto ANULADO que todavía nadie rehízo, el
 * nuevo es su re-liquidación (DATABASE.md §6): `revision + 1`, `supersedes_settlement_id` y la
 * MISMA versión de la política que el anulado (una semana reabierta conserva su versión).
 * Rehacer es solo de Dueño/Encargado. Nunca quedan dos repartos vigentes superpuestos.
 */
async function createPeriodInTx(
  tx: DbClient,
  access: AccessContext,
  weekStart: string,
  currentPolicyVersionId: string,
  redoOf?: string,
): Promise<ServiceResult<{ settlementId: string; created: boolean }>> {
  const weekEnd = addDays(weekStart, 6);
  const [taken, overlapping, previous] = await Promise.all([
    tx.weeklySettlement.findFirst({
      where: {
        restaurantId: access.restaurantId,
        status: { not: 'VOIDED' },
        weekStart: { lte: dateOf(weekEnd) },
        weekEnd: { gte: dateOf(weekStart) },
      },
      select: { id: true },
    }),
    tx.dailyDistribution.findFirst({
      where: {
        restaurantId: access.restaurantId,
        status: { not: 'VOIDED' },
        dateFrom: { lte: dateOf(weekEnd) },
        dateTo: { gte: dateOf(weekStart) },
      },
      select: { id: true },
    }),
    tx.weeklySettlement.findFirst({
      where: { restaurantId: access.restaurantId, weekStart: dateOf(weekStart) },
      orderBy: { revision: 'desc' },
      select: {
        id: true,
        revision: true,
        status: true,
        policyVersionId: true,
        supersededBy: { select: { id: true } },
      },
    }),
  ]);
  if (taken || overlapping) {
    return fail('Esa semana ya tiene un reparto cerrado (o se superpone con uno).');
  }
  const supersedes =
    previous && previous.status === 'VOIDED' && !previous.supersededBy ? previous : null;
  if (redoOf && supersedes?.id !== redoOf) {
    return fail('Ese reparto ya no es el último de su semana: no se puede rehacer.');
  }
  if (supersedes && !roleAllowed(access.role, CAN.voidPeriod)) {
    return fail(
      'Esa semana tiene un reparto anulado: solo el Dueño o el Encargado pueden rehacerlo.',
    );
  }

  const settlement = await tx.weeklySettlement.create({
    data: {
      restaurantId: access.restaurantId,
      weekStart: dateOf(weekStart),
      weekEnd: dateOf(weekEnd),
      revision: (previous?.revision ?? 0) + 1,
      supersedesSettlementId: supersedes?.id ?? null,
      policyVersionId: supersedes?.policyVersionId ?? currentPolicyVersionId,
      createdById: access.userId,
    },
    select: { id: true },
  });
  await tx.dailyDistribution.create({
    data: {
      restaurantId: access.restaurantId,
      scope: 'PERIOD',
      dateFrom: dateOf(weekStart),
      dateTo: dateOf(weekEnd),
      createdById: access.userId,
    },
  });
  if (supersedes) {
    await tx.auditLog.create({
      data: {
        restaurantId: access.restaurantId,
        userId: access.userId,
        action: 'period.redone',
        entity: 'weekly_settlements',
        entityId: settlement.id,
        payload: { supersedes: supersedes.id, weekStart },
      },
    });
  }
  return { ok: true, value: { settlementId: settlement.id, created: true } };
}

// ─────────────────────────── Anular y rehacer ───────────────────────────

/**
 * Anula un reparto CERRADO (DATABASE.md §6), en UNA transacción y sin borrar nada:
 *   1. solo si ningún sobre está ENTREGADO (primero se revierten esas entregas, con motivo);
 *   2. sobres PENDING/PREPARED → VOIDED, con su evento VOIDED y el motivo;
 *   3. el reparto diario se desvincula del período y queda VOIDED; sus descuentos de adelantos se
 *      revierten (`reverted_at`) y esos adelantos vuelven a tener saldo: el reparto nuevo los
 *      aplica con aplicaciones NUEVAS (las viejas quedan en la historia);
 *   4. el período queda VOIDED con quién, cuándo y por qué, y una fila en audit_log.
 * Ítems, importes, horas, snapshot y bitácoras del original no se tocan (y la base los congela).
 * Bloqueos en el orden de Sobres: período → sobres (y después los adelantos por id).
 */
export async function voidPeriod(
  db: PrismaClient,
  access: AccessContext,
  input: VoidPeriodInput,
): Promise<ServiceResult<{ settlementId: string }>> {
  assertRole(access, CAN.voidPeriod);
  return db.$transaction(async (tx) => {
    const period = await lockPeriod(tx, access.restaurantId, input.settlementId);
    if (!period) return fail(NOT_FOUND);
    if (period.status === 'VOIDED') return fail('Este reparto ya fue anulado.');
    if (period.status !== 'CLOSED') return fail('Solo se puede anular un reparto cerrado.');

    const payments = await tx.$queryRaw<{ id: string; status: string; net_cents: bigint }[]>`
      SELECT id::text AS id, status::text AS status, net_cents
      FROM weekly_payments
      WHERE restaurant_id = ${access.restaurantId}::uuid AND settlement_id = ${period.id}::uuid
      ORDER BY id
      FOR UPDATE`;
    const delivered = payments.filter((p) => p.status === 'DELIVERED').length;
    if (delivered > 0) {
      return fail(
        `No se puede anular: ${delivered === 1 ? 'hay 1 sobre entregado' : `hay ${delivered} sobres entregados`}. ` +
          'Primero revertí esas entregas en Sobres (con motivo) y después anulá el reparto.',
      );
    }

    const now = new Date();
    // 1) Sobres → VOIDED (con el motivo en su bitácora).
    const open = payments.filter((p) => p.status === 'PENDING' || p.status === 'PREPARED');
    if (open.length > 0) {
      await tx.weeklyPayment.updateMany({
        where: { id: { in: open.map((p) => p.id) }, status: { in: ['PENDING', 'PREPARED'] } },
        data: { status: 'VOIDED' },
      });
      await tx.weeklyPaymentEvent.createMany({
        data: open.map((p) => ({
          restaurantId: access.restaurantId,
          paymentId: p.id,
          eventType: 'VOIDED' as const,
          fromStatus: p.status as 'PENDING' | 'PREPARED',
          toStatus: 'VOIDED' as const,
          amountCents: p.net_cents,
          performedById: access.userId,
          reason: input.reason,
          occurredAt: now,
        })),
      });
    }

    // 2) Reparto diario: se libera del período, se anula y se revierten sus adelantos.
    const distribution = await tx.dailyDistribution.findFirst({
      where: { restaurantId: access.restaurantId, settlementId: period.id, status: 'CLOSED' },
      select: { id: true },
    });
    if (distribution) {
      await tx.dailyDistribution.update({
        where: { id: distribution.id },
        data: { settlementId: null },
      });
      await tx.dailyDistribution.update({
        where: { id: distribution.id },
        data: {
          status: 'VOIDED',
          voidedAt: now,
          voidedById: access.userId,
          voidReason: input.reason,
        },
      });
      const applications = await tx.advanceApplication.findMany({
        where: { item: { dailyDistributionId: distribution.id }, revertedAt: null },
        select: { id: true, advanceId: true, amountCents: true },
      });
      if (applications.length > 0) {
        const byAdvance = new Map<string, bigint>();
        for (const a of applications) {
          byAdvance.set(a.advanceId, (byAdvance.get(a.advanceId) ?? 0n) + a.amountCents);
        }
        const ids = [...byAdvance.keys()].sort();
        const locked = await tx.$queryRaw<{ id: string; applied_cents: bigint }[]>`
          SELECT id::text AS id, applied_cents FROM advances
          WHERE id = ANY(${ids}::uuid[]) AND restaurant_id = ${access.restaurantId}::uuid
          ORDER BY id
          FOR UPDATE`;
        await tx.advanceApplication.updateMany({
          where: { id: { in: applications.map((a) => a.id) }, revertedAt: null },
          data: { revertedAt: now },
        });
        for (const advance of locked) {
          const applied = advance.applied_cents - (byAdvance.get(advance.id) ?? 0n);
          await tx.advance.update({
            where: { id: advance.id },
            // Con saldo otra vez: PENDING (lo aplica el reparto nuevo, con una aplicación nueva).
            data: { appliedCents: applied, status: 'PENDING' },
          });
        }
      }
    }

    // 3) Período anulado (la base solo deja completar los datos de la anulación).
    await tx.weeklySettlement.update({
      where: { id: period.id },
      data: {
        status: 'VOIDED',
        voidedAt: now,
        voidedById: access.userId,
        voidReason: input.reason,
      },
    });
    await tx.auditLog.create({
      data: {
        restaurantId: access.restaurantId,
        userId: access.userId,
        action: 'period.voided',
        entity: 'weekly_settlements',
        entityId: period.id,
        payload: {
          reason: input.reason,
          weekStart: period.weekStart,
          voidedPayments: open.length,
        },
      },
    });
    return { ok: true, value: { settlementId: period.id } };
  }, TX_OPTIONS);
}

/**
 * Rehacer un reparto ANULADO: crea el período nuevo de la misma semana (revision + 1,
 * `supersedes_settlement_id`, misma versión de la política). No copia nada calculado: propina,
 * horas y cierre se cargan de nuevo. Idempotente: si ya se rehízo, devuelve el reparto nuevo.
 */
export async function redoPeriod(
  db: PrismaClient,
  access: AccessContext,
  input: RedoPeriodInput,
): Promise<ServiceResult<{ settlementId: string; created: boolean }>> {
  assertRole(access, CAN.voidPeriod);
  return db.$transaction(async (tx) => {
    // Mismo orden que "Empezar": primero el restaurante (dos pedidos a la vez se ordenan).
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM restaurants WHERE id = ${access.restaurantId}::uuid FOR UPDATE`;
    if (locked.length === 0) return fail('El restaurante no existe.');
    const original = await tx.weeklySettlement.findFirst({
      where: { id: input.settlementId, restaurantId: access.restaurantId },
      select: {
        id: true,
        status: true,
        weekStart: true,
        policyVersionId: true,
        supersededBy: { select: { id: true } },
      },
    });
    if (!original) return fail(NOT_FOUND);
    if (original.status !== 'VOIDED') return fail('Solo se puede rehacer un reparto anulado.');
    if (original.supersededBy) {
      return { ok: true, value: { settlementId: original.supersededBy.id, created: false } };
    }
    const open = await tx.weeklySettlement.findFirst({
      where: { restaurantId: access.restaurantId, status: 'OPEN' },
      select: { weekStart: true },
    });
    if (open) {
      return fail(
        `Ya hay un reparto abierto (semana del ${formatShortDate(isoOf(open.weekStart))}): cerralo antes de rehacer este.`,
      );
    }
    return createPeriodInTx(
      tx,
      access,
      isoOf(original.weekStart),
      original.policyVersionId,
      original.id,
    );
  }, TX_OPTIONS);
}

// ─────────────────────────── Propina ───────────────────────────

export async function setPeriodTips(
  db: PrismaClient,
  access: AccessContext,
  input: SetTipsInput,
): Promise<ServiceResult<{ totalCents: bigint }>> {
  assertRole(access, CAN.editPeriod);
  return db.$transaction(async (tx) => {
    const opened = await openPeriod(tx, access.restaurantId, input.settlementId);
    if (!opened.ok) return opened;
    const period = opened.value;
    const distributionId = await draftDistributionId(tx, access.restaurantId, period);
    if (!distributionId) return fail(NOT_FOUND);

    let entries: { date: string; cents: bigint; note: string | null }[];
    if (input.mode === 'total') {
      // El total se guarda como una sola propina, fechada el último día del período.
      entries = [{ date: period.weekEnd, cents: input.total, note: PERIOD_TOTAL_NOTE }];
    } else {
      const seen = new Set<string>();
      entries = [];
      for (const day of input.days) {
        if (day.date < period.weekStart || day.date > period.weekEnd) {
          return fail('Ese día no es de este período.');
        }
        if (seen.has(day.date)) return fail('Hay un día repetido.');
        seen.add(day.date);
        entries.push({ date: day.date, cents: day.amount, note: null });
      }
    }

    await tx.tipEntry.deleteMany({ where: { dailyDistributionId: distributionId } });
    const rows = entries.filter((e) => e.cents > 0n);
    if (rows.length > 0) {
      await tx.tipEntry.createMany({
        data: rows.map((e) => ({
          dailyDistributionId: distributionId,
          entryDate: dateOf(e.date),
          currency: 'ARS' as const,
          amountCents: e.cents,
          amountArsCents: e.cents,
          note: e.note,
        })),
      });
    }
    return { ok: true, value: { totalCents: rows.reduce((sum, e) => sum + e.cents, 0n) } };
  }, TX_OPTIONS);
}

// ─────────────────────────── Horas ───────────────────────────

/** Guarda las horas de una o varias personas (null = borrar: vuelve a "sin cargar"). */
export async function setPeriodHours(
  db: PrismaClient,
  access: AccessContext,
  input: SetHoursInput,
): Promise<ServiceResult<{ saved: number }>> {
  assertRole(access, CAN.editPeriod);
  const byEmployee = new Map<string, string | null>();
  for (const entry of input.entries) byEmployee.set(entry.employeeId, entry.hours);
  const ids = [...byEmployee.keys()];
  return db.$transaction(async (tx) => {
    const opened = await openPeriod(tx, access.restaurantId, input.settlementId);
    if (!opened.ok) return opened;
    const found = await tx.employee.findMany({
      where: { id: { in: ids }, restaurantId: access.restaurantId, archivedAt: null },
      select: { id: true },
    });
    if (found.length !== ids.length) return fail('Esa persona no existe.');

    await tx.periodHours.deleteMany({
      where: {
        restaurantId: access.restaurantId,
        settlementId: opened.value.id,
        employeeId: { in: ids },
      },
    });
    const values = [...byEmployee].filter((pair): pair is [string, string] => pair[1] !== null);
    if (values.length > 0) {
      await tx.periodHours.createMany({
        data: values.map(([employeeId, hours]) => ({
          restaurantId: access.restaurantId,
          settlementId: opened.value.id,
          employeeId,
          hours: hours.replace(',', '.'),
          updatedById: access.userId,
        })),
      });
    }
    return { ok: true, value: { saved: ids.length } };
  }, TX_OPTIONS);
}

// ─────────────────────────── Adelantos ───────────────────────────

export async function addPeriodAdvance(
  db: PrismaClient,
  access: AccessContext,
  input: AddAdvanceInput,
): Promise<ServiceResult<{ advanceId: string }>> {
  assertRole(access, CAN.editPeriod);
  if (input.amount <= 0n) return fail('Adelanto: ingresá un importe mayor que cero.');
  return db.$transaction(async (tx) => {
    const opened = await openPeriod(tx, access.restaurantId, input.settlementId);
    if (!opened.ok) return opened;
    const period = opened.value;
    if (input.date < period.weekStart || input.date > period.weekEnd) {
      return fail('La fecha del adelanto tiene que ser de este período.');
    }
    const employee = await tx.employee.findFirst({
      where: {
        id: input.employeeId,
        restaurantId: access.restaurantId,
        archivedAt: null,
        active: true,
      },
      select: { id: true },
    });
    if (!employee) return fail('Esa persona no existe.');
    const advance = await tx.advance.create({
      data: {
        restaurantId: access.restaurantId,
        employeeId: employee.id,
        date: dateOf(input.date),
        amountCents: input.amount,
        note: input.note === '' ? null : input.note,
        createdById: access.userId,
      },
      select: { id: true },
    });
    return { ok: true, value: { advanceId: advance.id } };
  }, TX_OPTIONS);
}

/** Anula un adelanto que todavía no se descontó (nunca se borra: queda con motivo). */
export async function voidPeriodAdvance(
  db: PrismaClient,
  access: AccessContext,
  input: VoidAdvanceInput,
): Promise<ServiceResult<{ advanceId: string }>> {
  assertRole(access, CAN.editPeriod);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; status: string; applied_cents: bigint }[]>`
      SELECT id::text AS id, status::text AS status, applied_cents
      FROM advances
      WHERE id = ${input.advanceId}::uuid AND restaurant_id = ${access.restaurantId}::uuid
      FOR UPDATE`;
    const advance = rows[0];
    if (!advance) return fail('Ese adelanto no existe.');
    if (advance.status !== 'PENDING' || advance.applied_cents > 0n) {
      return fail('Ese adelanto ya se descontó en un reparto cerrado: no se puede anular.');
    }
    await tx.advance.update({
      where: { id: advance.id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedById: access.userId,
        voidReason: input.reason,
      },
    });
    return { ok: true, value: { advanceId: advance.id } };
  }, TX_OPTIONS);
}

// ─────────────────────────── Cierre ───────────────────────────

const decimalText = (value: bigint, scale: number) =>
  formatScaled(value, scale, scale).replace(/\./g, '').replace(',', '.');

export interface CloseResult {
  settlementId: string;
  totalCents: bigint;
  totalFinalCents: bigint;
  payments: number;
}

export async function closePeriod(
  db: PrismaClient,
  access: AccessContext,
  input: ClosePeriodInput,
): Promise<ServiceResult<CloseResult>> {
  assertRole(access, CAN.closePeriod);
  return db.$transaction(async (tx) => {
    const opened = await openPeriod(tx, access.restaurantId, input.settlementId);
    if (!opened.ok) return opened;
    const period = opened.value;

    // Los adelantos que se pueden descontar quedan bloqueados hasta el fin del cierre (I11).
    await tx.$queryRaw`
      SELECT id FROM advances
      WHERE restaurant_id = ${access.restaurantId}::uuid AND status = 'PENDING'
        AND date <= ${period.weekEnd}::date
      ORDER BY id
      FOR UPDATE`;
    const data = await loadPeriodData(tx, access.restaurantId, period);
    if (!data || !data.distributionId) return fail(NOT_FOUND);

    const preview = buildPeriodPreview({
      totalCents: data.tips.totalCents,
      unitCents: data.unitCents,
      method: data.method,
      sectors: data.sectors,
      people: data.people,
    });
    if (!preview.canClose) {
      return fail(
        preview.issues.map((i) => i.message).join(' ') || 'Faltan datos para cerrar el reparto.',
      );
    }

    // El puesto de cada persona es el que usó el cálculo (loadPeriodData): su puesto actual,
    // con la porción de la versión de la política del período. El snapshot guarda SOLO lo que el
    // método usó: la porción (si interviene) y los puntos individuales (si intervienen).
    const uses = methodUses(data.method);
    const calcVersion = calcVersionFor(data.method, data.sectors !== null);
    const portions = new Map(data.policy.positions.map((p) => [p.positionId, p]));
    const positionOf = new Map(data.people.map((p) => [p.employeeId, p.positionId]));
    const worked = preview.rows.filter((r) => r.state === 'worked');

    // 1) Ítems del reparto (snapshot) mientras sigue en DRAFT.
    const items = await tx.dailyDistributionItem.createManyAndReturn({
      data: worked.map((row) => {
        const positionId = positionOf.get(row.employeeId) ?? '';
        const position = portions.get(positionId);
        return {
          dailyDistributionId: data.distributionId as string,
          employeeId: row.employeeId,
          positionId,
          employeeNameSnapshot: row.name,
          positionNameSnapshot: position?.name ?? '',
          portionSnapshot: uses.factor ? (position?.portion ?? '0') : null,
          individualPointsSnapshot: uses.points
            ? decimalText(row.pointsE2 ?? 0n, INDIVIDUAL_POINTS_SCALE)
            : null,
          hours: decimalText(row.hoursE2 ?? 0n, 2),
          // Ponderado exacto (E8). Con BY_POSITION es el mismo número que antes (horas × porción).
          points: decimalText(row.weightE8, WEIGHT_SCALE),
          // Participación como fracción 0..1: del ponderado total con pozo único; con sectores,
          // del importe sobre el total (los ponderados de sectores distintos no se comparan).
          percentage: decimalText(
            preview.sectors
              ? (row.amountCents * 1_000_000n * 2n + preview.totalCents) / (preview.totalCents * 2n)
              : (row.weightE8 * 1_000_000n * 2n + preview.totalWeightE8) /
                  (preview.totalWeightE8 * 2n),
            6,
          ),
          amountCents: row.amountCents,
          advancesCents: row.advanceAppliedCents,
          finalCents: row.finalCents,
        };
      }),
      select: { id: true, employeeId: true },
    });
    const itemOf = new Map(items.map((i) => [i.employeeId, i.id]));

    // 2) Adelantos: se descuentan del más viejo al más nuevo hasta lo aplicado a cada persona.
    for (const row of worked) {
      let remaining = row.advanceAppliedCents;
      if (remaining <= 0n) continue;
      for (const advance of data.advances) {
        if (remaining === 0n) break;
        if (advance.employeeId !== row.employeeId) continue;
        const balance = advance.amountCents - advance.appliedCents;
        if (balance <= 0n) continue;
        const take = balance < remaining ? balance : remaining;
        await tx.advanceApplication.create({
          data: {
            advanceId: advance.id,
            dailyDistributionItemId: itemOf.get(row.employeeId) as string,
            amountCents: take,
          },
        });
        const applied = advance.appliedCents + take;
        await tx.advance.update({
          where: { id: advance.id },
          data: {
            appliedCents: applied,
            status: applied === advance.amountCents ? 'APPLIED' : 'PENDING',
          },
        });
        remaining -= take;
      }
    }

    // 3) El reparto queda cerrado y ligado al período.
    const now = new Date();
    await tx.dailyDistribution.update({
      where: { id: data.distributionId },
      data: {
        status: 'CLOSED',
        tipsArsCents: preview.totalCents,
        totalCents: preview.totalCents,
        totalPoints: decimalText(preview.totalWeightE8, WEIGHT_SCALE),
        totalAdvancesCents: preview.totalAdvanceCents,
        totalFinalCents: preview.totalFinalCents,
        closedAt: now,
        closedById: access.userId,
        settlementId: period.id,
      },
    });

    // 4) Un sobre por persona que trabajó, con su evento de creación. Si este reparto rehace uno
    //    anulado, cada sobre nuevo apunta al sobre anulado de la misma persona (DATABASE.md §6).
    const superseded = await tx.weeklySettlement.findUnique({
      where: { id: period.id },
      select: { supersedes: { select: { payments: { select: { id: true, employeeId: true } } } } },
    });
    const previousPayment = new Map(
      (superseded?.supersedes?.payments ?? []).map((p) => [p.employeeId, p.id]),
    );
    const payments = await tx.weeklyPayment.createManyAndReturn({
      data: worked.map((row) => ({
        supersedesPaymentId: previousPayment.get(row.employeeId) ?? null,
        restaurantId: access.restaurantId,
        settlementId: period.id,
        employeeId: row.employeeId,
        employeeNameSnapshot: row.name,
        periodStart: dateOf(period.weekStart),
        periodEnd: dateOf(period.weekEnd),
        grossCents: row.amountCents,
        advancesCents: row.advanceAppliedCents,
        netCents: row.finalCents,
      })),
      select: { id: true, netCents: true },
    });
    if (payments.length > 0) {
      await tx.weeklyPaymentEvent.createMany({
        data: payments.map((p) => ({
          restaurantId: access.restaurantId,
          paymentId: p.id,
          eventType: 'CREATED' as const,
          toStatus: 'PENDING' as const,
          amountCents: p.netCents,
          performedById: access.userId,
        })),
      });
    }

    // 5) Período cerrado con la configuración usada (snapshot) y bitácora.
    const restaurant = await tx.restaurant.findUnique({
      where: { id: access.restaurantId },
      select: { portionDisplay: true },
    });
    await tx.weeklySettlement.update({
      where: { id: period.id },
      data: {
        status: 'CLOSED',
        policySnapshot: {
          policyVersionId: data.policy.id,
          number: data.policy.number,
          values: { ...data.policy.values },
          periodStartWeekday: data.policy.columns.periodStartWeekday,
          roundingUnit: data.policy.columns.roundingUnit,
          // Método de participación usado (los puntos de cada persona quedan en su ítem).
          portionMode: data.policy.columns.portionMode,
          poolStructure: data.policy.columns.poolStructure,
          positions: data.policy.positions.map((p) => ({
            positionId: p.positionId,
            name: p.name,
            portion: p.portion,
            stage: p.stage,
            stagePercent: p.stagePercent,
          })),
          // Por sectores: cada etapa con su base y el monto de cada sector (lo lee el historial).
          ...(preview.sectors
            ? { sectorStages: stagesToView(preview.sectors.stages, preview.sectors.people) }
            : {}),
          // Cómo se mostraba la porción al cerrar (solo auditoría: no interviene en el cálculo).
          portionDisplay: restaurant?.portionDisplay ?? 'DECIMAL',
          formula: FORMULA_STATUS,
        },
        calcVersion,
        totalCents: preview.totalCents,
        totalAdvancesCents: preview.totalAdvanceCents,
        totalFinalCents: preview.totalFinalCents,
        closedAt: now,
        closedById: access.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        restaurantId: access.restaurantId,
        userId: access.userId,
        action: 'period.closed',
        entity: 'weekly_settlements',
        entityId: period.id,
        payload: {
          weekStart: period.weekStart,
          totalCents: preview.totalCents.toString(),
          totalFinalCents: preview.totalFinalCents.toString(),
          people: worked.length,
          calcVersion,
          method: data.method,
        },
      },
    });

    return {
      ok: true,
      value: {
        settlementId: period.id,
        totalCents: preview.totalCents,
        totalFinalCents: preview.totalFinalCents,
        payments: payments.length,
      },
    };
  }, TX_OPTIONS);
}
