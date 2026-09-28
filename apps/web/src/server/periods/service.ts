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
import { addDays, periodStartOf, todayInTimeZone } from '@/lib/dates';
import { buildPeriodPreview } from '@/lib/distribution/period-preview';
import { PERIOD_TOTAL_NOTE } from '@/lib/distribution/period-view';
import { FORMULA_STATUS } from '@/lib/distribution/provisional-formula';
import { formatScaled } from '@/lib/decimal';
import { assertRole, type AccessContext } from '../access/access';
import { CAN } from '../access/roles';
import { getPolicyVersion, type DbClient } from '../policy/repository';
import { TX_OPTIONS, type ServiceResult } from '../policy/service';
import { dateOf, loadPeriodData, type PeriodRow } from './repository';
import type {
  AddAdvanceInput,
  ClosePeriodInput,
  SetHoursInput,
  SetTipsInput,
  StartPeriodInput,
  VoidAdvanceInput,
} from './schemas';

/** Versión del cálculo que queda registrada en cada cierre. */
export const CALC_VERSION = 'provisional-1';

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
    const weekEnd = addDays(weekStart, 6);

    const taken = await tx.weeklySettlement.findFirst({
      where: {
        restaurantId: access.restaurantId,
        status: { not: 'VOIDED' },
        weekStart: { lte: dateOf(weekEnd) },
        weekEnd: { gte: dateOf(weekStart) },
      },
      select: { id: true },
    });
    const overlapping = await tx.dailyDistribution.findFirst({
      where: {
        restaurantId: access.restaurantId,
        status: { not: 'VOIDED' },
        dateFrom: { lte: dateOf(weekEnd) },
        dateTo: { gte: dateOf(weekStart) },
      },
      select: { id: true },
    });
    if (taken || overlapping) {
      return fail('Esa semana ya tiene un reparto cerrado (o se superpone con uno).');
    }

    const settlement = await tx.weeklySettlement.create({
      data: {
        restaurantId: access.restaurantId,
        weekStart: dateOf(weekStart),
        weekEnd: dateOf(weekEnd),
        policyVersionId: policy.id,
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
    return { ok: true, value: { settlementId: settlement.id, created: true } };
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
      people: data.people,
    });
    if (!preview.canClose) {
      return fail(
        preview.issues.map((i) => i.message).join(' ') || 'Faltan datos para cerrar el reparto.',
      );
    }

    // El puesto de cada persona es el que usó el cálculo (loadPeriodData): su puesto actual,
    // con la porción de la versión de la política del período.
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
          portionSnapshot: position?.portion ?? '0',
          hours: decimalText(row.hoursE2 ?? 0n, 2),
          points: decimalText(row.pointsE6, 6),
          percentage: decimalText(
            (row.pointsE6 * 1_000_000n * 2n + preview.totalPointsE6) / (preview.totalPointsE6 * 2n),
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
        totalPoints: decimalText(preview.totalPointsE6, 6),
        totalAdvancesCents: preview.totalAdvanceCents,
        totalFinalCents: preview.totalFinalCents,
        closedAt: now,
        closedById: access.userId,
        settlementId: period.id,
      },
    });

    // 4) Un sobre por persona que trabajó, con su evento de creación.
    const payments = await tx.weeklyPayment.createManyAndReturn({
      data: worked.map((row) => ({
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
          positions: data.policy.positions.map((p) => ({
            positionId: p.positionId,
            name: p.name,
            portion: p.portion,
          })),
          formula: FORMULA_STATUS,
        },
        calcVersion: CALC_VERSION,
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
          calcVersion: CALC_VERSION,
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
