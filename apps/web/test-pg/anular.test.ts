import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { parseHistoryFilters } from '@/lib/history/filters';
import { AccessDenied, authorize, type AccessContext } from '@/server/access/access';
import { CAN, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import {
  deliverEnvelopeInput,
  prepareEnvelopesInput,
  revertDeliveryInput,
} from '@/server/envelopes/schemas';
import { deliverEnvelope, prepareEnvelopes, revertDelivery } from '@/server/envelopes/service';
import { getHistoryDetail, listHistory } from '@/server/history/repository';
import { getOpenPeriodView } from '@/server/periods/repository';
import {
  addAdvanceInput,
  closePeriodInput,
  redoPeriodInput,
  setHoursInput,
  setTipsInput,
  startPeriodInput,
  voidPeriodInput,
} from '@/server/periods/schemas';
import {
  addPeriodAdvance,
  closePeriod,
  redoPeriod,
  setPeriodHours,
  setPeriodTips,
  startPeriod,
  voidPeriod,
} from '@/server/periods/service';
import { bootstrapRestaurant, changePolicy } from '@/server/policy/service';
import { addEmployee } from '@/server/staff/service';

/*
 * Anular y rehacer un reparto cerrado (DATABASE.md §6) contra PostgreSQL real, con todos los
 * triggers: el original queda VOIDED e intacto y el nuevo es una re-liquidación independiente.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

type Puesto = 'Supervisor' | 'Barra' | 'Salón' | 'Bacha';

async function restaurant(name = 'Local') {
  const input = {
    restaurantId: randomUUID(),
    restaurantName: name,
    operatorEmail: `owner-${randomUUID()}@example.invalid`,
    operatorName: 'Dueño',
  };
  const result = await bootstrapRestaurant(db, input);
  if (!result.ok) throw new Error(result.error);
  const owner: SessionUser = { id: result.value.userId, email: input.operatorEmail, name: 'Dueño' };
  const positions = Object.fromEntries(
    (await db.position.findMany({ where: { restaurantId: input.restaurantId } })).map((p) => [
      p.name,
      p.id,
    ]),
  ) as Record<Puesto, string>;
  const manage = await authorize(db, owner, { roles: CAN.manageStaff });
  const ids: Record<'Ana' | 'Beto', string> = { Ana: '', Beto: '' };
  for (const [name, puesto] of [
    ['Ana', 'Salón'],
    ['Beto', 'Barra'],
  ] as const) {
    const added = await addEmployee(db, manage, { name, positionId: positions[puesto] });
    if (!added.ok) throw new Error(added.error);
    ids[name] = added.value.employeeId;
  }
  return { id: input.restaurantId, owner, positions, ids };
}
type R = Awaited<ReturnType<typeof restaurant>>;

async function member(
  restaurantId: string,
  role: Exclude<Role, 'OWNER'>,
  employeeId?: string,
): Promise<SessionUser> {
  const email = `u-${randomUUID()}@example.invalid`;
  const user = await db.user.create({ data: { email, name: role } });
  await db.membership.create({ data: { userId: user.id, restaurantId, role, employeeId } });
  return { id: user.id, email, name: role };
}

const as = (user: SessionUser, roles: readonly Role[]): Promise<AccessContext> =>
  authorize(db, user, { roles });

const WEEK = '2025-09-03'; // semana del 2025-09-01

/** Carga propina y horas en un período abierto (y un adelanto a Ana en el primero). */
async function load(r: R, settlementId: string, total: string, anaHours: string, advance = false) {
  const edit = await as(r.owner, CAN.editPeriod);
  await setPeriodTips(db, edit, setTipsInput.parse({ mode: 'total', settlementId, total }));
  await setPeriodHours(
    db,
    edit,
    setHoursInput.parse({
      settlementId,
      entries: [
        { employeeId: r.ids.Ana, hours: anaHours },
        { employeeId: r.ids.Beto, hours: '10' },
      ],
    }),
  );
  if (advance) {
    const added = await addPeriodAdvance(
      db,
      edit,
      addAdvanceInput.parse({
        settlementId,
        employeeId: r.ids.Ana,
        date: WEEK,
        amount: '5.000',
        note: 'adelanto',
      }),
    );
    if (!added.ok) throw new Error(added.error);
  }
}

async function close(r: R, settlementId: string) {
  const closed = await closePeriod(
    db,
    await as(r.owner, CAN.closePeriod),
    closePeriodInput.parse({ settlementId }),
  );
  if (!closed.ok) throw new Error(closed.error);
}

/** Reparto cerrado: $ 100.000, Ana 30 h (adelanto $ 5.000), Beto 10 h. */
async function closedPeriod(r: R): Promise<string> {
  const started = await startPeriod(
    db,
    await as(r.owner, CAN.editPeriod),
    startPeriodInput.parse({ date: WEEK }),
  );
  if (!started.ok) throw new Error(started.error);
  await load(r, started.value.settlementId, '100.000', '30', true);
  await close(r, started.value.settlementId);
  return started.value.settlementId;
}

const voidIt = async (
  user: SessionUser,
  settlementId: string,
  reason = 'se cargó mal la propina',
) =>
  voidPeriod(db, await as(user, CAN.voidPeriod), voidPeriodInput.parse({ settlementId, reason }));
const redo = async (user: SessionUser, settlementId: string) =>
  redoPeriod(db, await as(user, CAN.voidPeriod), redoPeriodInput.parse({ settlementId }));

/** Foto de todo lo que el cierre guardó del reparto (para comprobar que no cambia). */
async function snapshot(settlementId: string) {
  const settlement = await db.weeklySettlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      totalCents: true,
      totalAdvancesCents: true,
      totalFinalCents: true,
      policySnapshot: true,
      calcVersion: true,
      policyVersionId: true,
      closedAt: true,
      restaurantId: true,
      weekStart: true,
    },
  });
  // Ítems del reparto diario de esa semana (vinculado o, si se anuló, desvinculado).
  const items = await db.dailyDistributionItem.findMany({
    where: {
      dailyDistribution: {
        restaurantId: settlement.restaurantId,
        dateFrom: settlement.weekStart,
        status: { in: ['CLOSED', 'VOIDED'] },
        closedAt: { lte: settlement.closedAt ?? undefined },
      },
    },
    orderBy: { employeeId: 'asc' },
    select: {
      employeeId: true,
      hours: true,
      portionSnapshot: true,
      points: true,
      amountCents: true,
      advancesCents: true,
      finalCents: true,
    },
  });
  const payments = await db.weeklyPayment.findMany({
    where: { settlementId },
    orderBy: { employeeId: 'asc' },
    select: { employeeId: true, grossCents: true, advancesCents: true, netCents: true },
  });
  return {
    settlement,
    payments,
    items: items.map((i) => ({
      ...i,
      hours: i.hours.toString(),
      portionSnapshot: i.portionSnapshot?.toString(),
      points: i.points.toString(),
    })),
  };
}

describe('anular un reparto cerrado', () => {
  it('CLOSED → VOIDED con quién, cuándo, motivo y auditoría; el original queda intacto', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    const before = await snapshot(id);
    const historyBefore = await getHistoryDetail(db, await as(r.owner, CAN.viewHistory), id);

    expect(voidPeriodInput.safeParse({ settlementId: id, reason: 'corto' }).success).toBe(false);
    expect(await voidIt(r.owner, id)).toEqual({ ok: true, value: { settlementId: id } });

    const voided = await db.weeklySettlement.findUniqueOrThrow({ where: { id } });
    expect(voided).toMatchObject({
      status: 'VOIDED',
      voidedById: r.owner.id,
      voidReason: 'se cargó mal la propina',
    });
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(await db.auditLog.count({ where: { entityId: id, action: 'period.voided' } })).toBe(1);
    // Nada de lo guardado cambió: totales, snapshot, sobres (importes) e historial.
    expect(await snapshot(id)).toEqual(before);
    const historyAfter = await getHistoryDetail(db, await as(r.owner, CAN.viewHistory), id);
    expect(historyAfter?.people.map((p) => [p.name, p.hours, p.factor, p.finalCents])).toEqual(
      historyBefore?.people.map((p) => [p.name, p.hours, p.factor, p.finalCents]),
    );
    expect(historyAfter).toMatchObject({ status: 'VOIDED', totals: historyBefore?.totals });

    // Sobres anulados con su evento; el reparto diario desvinculado y anulado.
    const payments = await db.weeklyPayment.findMany({ where: { settlementId: id } });
    expect(payments.every((p) => p.status === 'VOIDED')).toBe(true);
    expect(
      await db.weeklyPaymentEvent.count({
        where: {
          payment: { settlementId: id },
          eventType: 'VOIDED',
          reason: 'se cargó mal la propina',
        },
      }),
    ).toBe(2);
    const distribution = await db.dailyDistribution.findFirstOrThrow({
      where: { restaurantId: r.id, dateFrom: new Date('2025-09-01T00:00:00Z') },
    });
    expect(distribution).toMatchObject({ status: 'VOIDED', settlementId: null });
  });

  it('no se edita, no se cierra de nuevo, no se anula dos veces, no genera sobres', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    await voidIt(r.owner, id);
    const edit = await as(r.owner, CAN.editPeriod);
    expect(
      (
        await setPeriodHours(
          db,
          edit,
          setHoursInput.parse({
            settlementId: id,
            entries: [{ employeeId: r.ids.Ana, hours: '1' }],
          }),
        )
      ).ok,
    ).toBe(false);
    expect(
      await close(r, id)
        .then(() => 'ok')
        .catch((e: Error) => e.message),
    ).not.toBe('ok');
    expect(await voidIt(r.owner, id)).toEqual({ ok: false, error: 'Este reparto ya fue anulado.' });
    expect(
      await prepareEnvelopes(
        db,
        await as(r.owner, CAN.handleEnvelopes),
        prepareEnvelopesInput.parse({ settlementId: id }),
      ),
    ).toEqual({ ok: false, error: 'Este reparto fue anulado: sus sobres no se pueden modificar.' });
    expect(await db.weeklyPayment.count({ where: { settlementId: id } })).toBe(2);
    // La base tampoco deja tocarlo.
    await expect(
      db.weeklySettlement.update({ where: { id }, data: { totalCents: 1n } }),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      db.weeklyPayment.updateMany({ where: { settlementId: id }, data: { status: 'PENDING' } }),
    ).rejects.toThrow(/IMMUTABLE/);
    // Un reparto abierto no se "anula" (no es un cierre): error seguro.
    const open = await startPeriod(db, edit, startPeriodInput.parse({ date: '2025-09-10' }));
    if (!open.ok) throw new Error(open.error);
    expect(await voidIt(r.owner, open.value.settlementId)).toEqual({
      ok: false,
      error: 'Solo se puede anular un reparto cerrado.',
    });
  });

  it('con sobres preparados se anula (quedan VOIDED); con uno entregado se bloquea hasta revertirlo', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    const handle = await as(r.owner, CAN.handleEnvelopes);
    await prepareEnvelopes(db, handle, prepareEnvelopesInput.parse({ settlementId: id }));
    const ana = await db.weeklyPayment.findFirstOrThrow({
      where: { settlementId: id, employeeId: r.ids.Ana },
    });
    await deliverEnvelope(db, handle, deliverEnvelopeInput.parse({ paymentId: ana.id }));

    const blocked = await voidIt(r.owner, id);
    expect(blocked).toEqual({
      ok: false,
      error:
        'No se puede anular: hay 1 sobre entregado. Primero revertí esas entregas en Sobres (con motivo) y después anulá el reparto.',
    });
    expect((await db.weeklySettlement.findUniqueOrThrow({ where: { id } })).status).toBe('CLOSED');

    await revertDelivery(
      db,
      await as(r.owner, CAN.revertDelivery),
      revertDeliveryInput.parse({ paymentId: ana.id, reason: 'se entregó por error' }),
    );
    expect((await voidIt(r.owner, id)).ok).toBe(true);
    const events = await db.weeklyPaymentEvent.findMany({
      where: { paymentId: ana.id },
      orderBy: { occurredAt: 'asc' },
    });
    // La entrega y su reversión siguen en la historia; el anulado sale de PREPARED.
    expect(events.map((e) => e.eventType)).toEqual([
      'CREATED',
      'PREPARED',
      'DELIVERED',
      'DELIVERY_REVERTED',
      'VOIDED',
    ]);
    expect(events.at(-1)).toMatchObject({ fromStatus: 'PREPARED', toStatus: 'VOIDED' });
  });
});

describe('rehacer', () => {
  it('reparto nuevo para la misma semana: id, revisión y vínculo propios; nada copiado', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    await voidIt(r.owner, id);
    const redone = await redo(r.owner, id);
    if (!redone.ok) throw new Error(redone.error);
    const newId = redone.value.settlementId;
    expect(newId).not.toBe(id);

    const created = await db.weeklySettlement.findUniqueOrThrow({ where: { id: newId } });
    const original = await db.weeklySettlement.findUniqueOrThrow({ where: { id } });
    expect(created).toMatchObject({
      status: 'OPEN',
      weekStart: original.weekStart,
      weekEnd: original.weekEnd,
      revision: 2,
      supersedesSettlementId: id,
      policyVersionId: original.policyVersionId,
      totalCents: null,
      policySnapshot: null,
    });
    // Sin horas ni propina copiadas: se cargan de nuevo.
    expect(await db.periodHours.count({ where: { settlementId: newId } })).toBe(0);
    expect(
      await db.tipEntry.count({
        where: { dailyDistribution: { restaurantId: r.id, status: 'DRAFT' } },
      }),
    ).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: newId, action: 'period.redone' } })).toBe(
      1,
    );
    // Idempotente: rehacer A otra vez devuelve B y no crea un C.
    expect(await redo(r.owner, id)).toEqual({
      ok: true,
      value: { settlementId: newId, created: false },
    });
    expect(
      await db.weeklySettlement.findMany({
        where: { restaurantId: r.id, weekStart: original.weekStart },
        orderBy: { revision: 'asc' },
        select: { id: true, revision: true, status: true },
      }),
    ).toEqual([
      { id, revision: 1, status: 'VOIDED' },
      { id: newId, revision: 2, status: 'OPEN' },
    ]);
    // "Empezar" esa semana sigue con el abierto (nunca dos vigentes).
    expect(
      await startPeriod(
        db,
        await as(r.owner, CAN.editPeriod),
        startPeriodInput.parse({ date: WEEK }),
      ),
    ).toEqual({ ok: true, value: { settlementId: newId, created: false } });
  });

  it('usa la versión de la política del original aunque la vigente haya cambiado', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    const changed = await changePolicy(
      db,
      { restaurantId: r.id, userId: r.owner.id },
      { kind: 'portion', positionId: r.positions.Salón, factor: '0,030' },
    );
    expect(changed.ok).toBe(true);
    const original = await db.weeklySettlement.findUniqueOrThrow({ where: { id } });
    await voidIt(r.owner, id);
    const redone = await redo(r.owner, id);
    if (!redone.ok) throw new Error(redone.error);
    const created = await db.weeklySettlement.findUniqueOrThrow({
      where: { id: redone.value.settlementId },
    });
    expect(created.policyVersionId).toBe(original.policyVersionId);
    // Un cambio de política posterior tampoco mueve al reparto rehecho (conserva su versión).
    await changePolicy(
      db,
      { restaurantId: r.id, userId: r.owner.id },
      { kind: 'portion', positionId: r.positions.Barra, factor: '0,030' },
    );
    expect(
      (await db.weeklySettlement.findUniqueOrThrow({ where: { id: created.id } })).policyVersionId,
    ).toBe(original.policyVersionId);
  });

  it('nuevo cálculo con datos nuevos; adelantos y sobres del original no se reutilizan', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    await voidIt(r.owner, id);

    // El adelanto de Ana volvió a tener saldo: su aplicación vieja quedó revertida (no borrada).
    const advance = await db.advance.findFirstOrThrow({ where: { restaurantId: r.id } });
    expect(advance).toMatchObject({ status: 'PENDING', appliedCents: 0n, amountCents: 500_000n });
    const oldApplications = await db.advanceApplication.findMany({
      where: { advanceId: advance.id },
    });
    expect(oldApplications).toHaveLength(1);
    expect(oldApplications[0]?.revertedAt).toBeInstanceOf(Date);

    const redone = await redo(r.owner, id);
    if (!redone.ok) throw new Error(redone.error);
    const newId = redone.value.settlementId;
    // Datos corregidos: $ 120.000 y Ana 20 h.
    await load(r, newId, '120.000', '20');
    await close(r, newId);

    const newPayments = await db.weeklyPayment.findMany({ where: { settlementId: newId } });
    const oldPayments = await db.weeklyPayment.findMany({ where: { settlementId: id } });
    expect(newPayments.map((p) => p.id).some((pid) => oldPayments.some((o) => o.id === pid))).toBe(
      false,
    );
    const newAna = newPayments.find((p) => p.employeeId === r.ids.Ana);
    // Ana 20 h × 0,022 = 0,44; Beto 0,22 → 2/3 de $ 120.000 = $ 80.000, menos el adelanto.
    expect(newAna).toMatchObject({
      grossCents: 8_000_000n,
      advancesCents: 500_000n,
      netCents: 7_500_000n,
      supersedesPaymentId: oldPayments.find((p) => p.employeeId === r.ids.Ana)?.id,
    });
    // El adelanto se descontó una sola vez vigente: aplicación nueva, la vieja sigue revertida.
    const applications = await db.advanceApplication.findMany({
      where: { advanceId: advance.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(applications.map((a) => a.revertedAt === null)).toEqual([false, true]);
    expect(await db.advance.findUniqueOrThrow({ where: { id: advance.id } })).toMatchObject({
      status: 'APPLIED',
      appliedCents: 500_000n,
    });
    // El original sigue mostrando sus valores (Ana 30 h, $ 75.000 − 5.000).
    const oldAna = oldPayments.find((p) => p.employeeId === r.ids.Ana);
    expect(oldAna).toMatchObject({
      grossCents: 7_500_000n,
      netCents: 7_000_000n,
      status: 'VOIDED',
    });
  });

  it('historial: ambos, vinculados, cada uno con lo suyo', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    await voidIt(r.owner, id);
    const redone = await redo(r.owner, id);
    if (!redone.ok) throw new Error(redone.error);
    await load(r, redone.value.settlementId, '120.000', '20');
    await close(r, redone.value.settlementId);

    const viewer = await as(r.owner, CAN.viewHistory);
    const list = await listHistory(db, viewer, parseHistoryFilters({ estado: 'TODOS' }));
    expect(list.items.map((i) => [i.settlementId, i.status])).toEqual([
      [redone.value.settlementId, 'CLOSED'],
      [id, 'VOIDED'],
    ]);
    const original = await getHistoryDetail(db, viewer, id);
    const next = await getHistoryDetail(db, viewer, redone.value.settlementId);
    expect(original).toMatchObject({
      status: 'VOIDED',
      voidReason: 'se cargó mal la propina',
      supersededBy: { settlementId: redone.value.settlementId, status: 'CLOSED' },
      canVoid: false,
      canRedo: false,
      detailAvailable: true,
    });
    expect(original?.people.map((p) => [p.name, p.hours, p.finalCents])).toEqual([
      ['Ana', '30', '7000000'],
      ['Beto', '10', '2500000'],
    ]);
    expect(next).toMatchObject({
      status: 'CLOSED',
      supersedes: { settlementId: id },
      canVoid: true,
    });
    expect(next?.people.map((p) => [p.name, p.hours, p.finalCents])).toEqual([
      ['Ana', '20', '7500000'],
      ['Beto', '10', '4000000'],
    ]);
    // Los sobres de cada uno son los suyos.
    const ids = (d: typeof next) => d?.people.map((p) => p.envelope?.paymentId);
    expect(ids(next)?.some((pid) => ids(original)?.includes(pid))).toBe(false);
  });

  it('no rehace con otro reparto abierto, ni lo que no está anulado', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    expect(await redo(r.owner, id)).toEqual({
      ok: false,
      error: 'Solo se puede rehacer un reparto anulado.',
    });
    await voidIt(r.owner, id);
    const other = await startPeriod(
      db,
      await as(r.owner, CAN.editPeriod),
      startPeriodInput.parse({ date: '2025-09-10' }),
    );
    expect(other.ok).toBe(true);
    const blocked = await redo(r.owner, id);
    expect(blocked).toEqual({
      ok: false,
      error: 'Ya hay un reparto abierto (semana del 08/09/2025): cerralo antes de rehacer este.',
    });
    // Nunca dos repartos vigentes superpuestos.
    const active = await db.weeklySettlement.count({
      where: {
        restaurantId: r.id,
        status: { not: 'VOIDED' },
        weekStart: new Date('2025-09-01T00:00:00Z'),
      },
    });
    expect(active).toBe(0);

    // Sin callejón sin salida: /reparto muestra ese borrador para continuarlo; al cerrarlo, se rehace.
    if (!other.ok) throw new Error(other.error);
    const draft = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(draft).toMatchObject({
      settlementId: other.value.settlementId,
      weekStart: '2025-09-08',
    });
    await load(r, other.value.settlementId, '50.000', '8');
    await close(r, other.value.settlementId);
    const redone = await redo(r.owner, id);
    expect(redone).toMatchObject({ ok: true, value: { created: true } });
  });
});

describe('permisos y aislamiento', () => {
  it('Encargado anula y rehace; Editor, Lector y SELF no; otro restaurante no ve nada', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    const editor = await member(r.id, 'EDITOR');
    const viewer = await member(r.id, 'VIEWER');
    const self = await member(r.id, 'SELF', r.ids.Beto);
    for (const user of [editor, viewer, self]) {
      await expect(as(user, CAN.voidPeriod)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    }
    // Aunque tenga un contexto (p. ej. de Editor), el servicio vuelve a verificar el rol.
    await expect(
      voidPeriod(
        db,
        await as(editor, CAN.editPeriod),
        voidPeriodInput.parse({ settlementId: id, reason: 'no debería poder' }),
      ),
    ).rejects.toBeInstanceOf(AccessDenied);

    const other = await restaurant('Otro');
    expect(await voidIt(other.owner, id)).toEqual({
      ok: false,
      error: 'No se encontró ese reparto.',
    });
    expect((await db.weeklySettlement.findUniqueOrThrow({ where: { id } })).status).toBe('CLOSED');

    const manager = await member(r.id, 'MANAGER');
    expect((await voidIt(manager, id)).ok).toBe(true);
    expect(await redo(other.owner, id)).toEqual({
      ok: false,
      error: 'No se encontró ese reparto.',
    });
    // El Editor tampoco rehace "por la puerta de atrás" empezando esa semana.
    expect(
      await startPeriod(
        db,
        await as(editor, CAN.editPeriod),
        startPeriodInput.parse({ date: WEEK }),
      ),
    ).toEqual({
      ok: false,
      error: 'Esa semana tiene un reparto anulado: solo el Dueño o el Encargado pueden rehacerlo.',
    });
    expect((await redo(manager, id)).ok).toBe(true);

    // SELF ve su parte del reparto anulado, sin totales ni acciones.
    const own = await getHistoryDetail(db, await as(self, CAN.viewHistory), id);
    expect(own).toMatchObject({ ownOnly: true, totals: null, canVoid: false, canRedo: false });
    expect(own?.people.map((p) => p.name)).toEqual(['Beto']);
  });
});

describe('concurrencia', () => {
  it('dos anulaciones a la vez: una gana, la otra recibe un estado seguro', async () => {
    const r = await restaurant();
    const id = await closedPeriod(r);
    const manager = await member(r.id, 'MANAGER');
    const results = await Promise.all([
      voidIt(r.owner, id),
      voidIt(manager, id, 'error de carga duplicado'),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.find((x) => !x.ok)).toEqual({
      ok: false,
      error: 'Este reparto ya fue anulado.',
    });
    expect(await db.auditLog.count({ where: { entityId: id, action: 'period.voided' } })).toBe(1);
    expect(
      await db.weeklyPaymentEvent.count({
        where: { payment: { settlementId: id }, eventType: 'VOIDED' },
      }),
    ).toBe(2);
  });

  it('anular y entregar a la vez: nunca queda un reparto anulado con un sobre entregado', async () => {
    for (let round = 0; round < 4; round += 1) {
      const r = await restaurant(`Carrera ${round}`);
      const id = await closedPeriod(r);
      const handle = await as(r.owner, CAN.handleEnvelopes);
      await prepareEnvelopes(db, handle, prepareEnvelopesInput.parse({ settlementId: id }));
      const ana = await db.weeklyPayment.findFirstOrThrow({
        where: { settlementId: id, employeeId: r.ids.Ana },
      });
      const manager = await member(r.id, 'MANAGER');
      const [voided, delivered] = await Promise.all([
        voidIt(manager, id),
        deliverEnvelope(db, handle, deliverEnvelopeInput.parse({ paymentId: ana.id })),
      ]);
      // Exactamente uno de los dos gana (sin deadlock ni estado imposible).
      expect([voided.ok, delivered.ok].filter(Boolean)).toHaveLength(1);
      const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id } });
      const payment = await db.weeklyPayment.findUniqueOrThrow({ where: { id: ana.id } });
      if (settlement.status === 'VOIDED') expect(payment.status).toBe('VOIDED');
      else expect(payment.status).toBe('DELIVERED');
    }
  });
});
