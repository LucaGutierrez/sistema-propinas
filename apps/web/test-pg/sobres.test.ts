import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { authorize, type AccessContext } from '@/server/access/access';
import { CAN, ROLES, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import { getEnvelopesView, listEnvelopePeriods } from '@/server/envelopes/repository';
import {
  deliverEnvelopeInput,
  prepareEnvelopesInput,
  revertDeliveryInput,
  undoPreparationInput,
} from '@/server/envelopes/schemas';
import {
  deliverEnvelope,
  prepareEnvelopes,
  revertDelivery,
  undoPreparation,
} from '@/server/envelopes/service';
import {
  addAdvanceInput,
  closePeriodInput,
  setHoursInput,
  setTipsInput,
  startPeriodInput,
} from '@/server/periods/schemas';
import {
  addPeriodAdvance,
  closePeriod,
  setPeriodHours,
  setPeriodTips,
  startPeriod,
} from '@/server/periods/service';
import { bootstrapRestaurant, changePolicy } from '@/server/policy/service';
import { addEmployee } from '@/server/staff/service';

/*
 * Sobres de punta a punta contra PostgreSQL real (con los triggers de weekly_payments), con el
 * mismo código que las páginas y acciones: `authorize` → Zod → servicio / repositorio.
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
  return { id: input.restaurantId, owner, positions };
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

const as = (user: SessionUser, roles: readonly Role[] = ROLES): Promise<AccessContext> =>
  authorize(db, user, { roles });

/**
 * Reparto cerrado: Ana (Salón, 30 h, adelanto $ 5.000), Beto (Barra, 10 h) y Carla (Bacha, 0 h:
 * no participa). Propina $ 100.000.
 */
async function closedPeriod(r: R) {
  const manage = await as(r.owner, CAN.manageStaff);
  const ids: Record<string, string> = {};
  for (const [name, puesto] of [
    ['Ana', 'Salón'],
    ['Beto', 'Barra'],
    ['Carla', 'Bacha'],
  ] as const) {
    const added = await addEmployee(db, manage, { name, positionId: r.positions[puesto] });
    if (!added.ok) throw new Error(added.error);
    ids[name] = added.value.employeeId;
  }
  const edit = await as(r.owner, CAN.editPeriod);
  const started = await startPeriod(db, edit, startPeriodInput.parse({ date: '2025-02-05' }));
  if (!started.ok) throw new Error(started.error);
  const settlementId = started.value.settlementId;
  await setPeriodTips(
    db,
    edit,
    setTipsInput.parse({ mode: 'total', settlementId, total: '100.000' }),
  );
  await setPeriodHours(
    db,
    edit,
    setHoursInput.parse({
      settlementId,
      entries: [
        { employeeId: ids.Ana, hours: '30' },
        { employeeId: ids.Beto, hours: '10' },
        { employeeId: ids.Carla, hours: '0' },
      ],
    }),
  );
  await addPeriodAdvance(
    db,
    edit,
    addAdvanceInput.parse({
      settlementId,
      employeeId: ids.Ana,
      date: '2025-02-05',
      amount: '5.000',
      note: '',
    }),
  );
  const closed = await closePeriod(
    db,
    await as(r.owner, CAN.closePeriod),
    closePeriodInput.parse({ settlementId }),
  );
  if (!closed.ok) throw new Error(closed.error);
  return { ids, settlementId };
}

const prepare = async (user: SessionUser, settlementId: string, paymentIds?: string[]) =>
  prepareEnvelopes(
    db,
    await as(user, CAN.handleEnvelopes),
    prepareEnvelopesInput.parse({ settlementId, paymentIds }),
  );
const deliver = async (user: SessionUser, paymentId: string) =>
  deliverEnvelope(
    db,
    await as(user, CAN.handleEnvelopes),
    deliverEnvelopeInput.parse({ paymentId }),
  );
const undo = async (user: SessionUser, paymentId: string, reason = 'se armó con otra plata') =>
  undoPreparation(
    db,
    await as(user, CAN.handleEnvelopes),
    undoPreparationInput.parse({ paymentId, reason }),
  );
const revert = async (user: SessionUser, paymentId: string, reason = 'se entregó a otra persona') =>
  revertDelivery(
    db,
    await as(user, CAN.revertDelivery),
    revertDeliveryInput.parse({ paymentId, reason }),
  );

const paymentOf = (settlementId: string, employeeId: string | undefined) =>
  db.weeklyPayment.findFirstOrThrow({ where: { settlementId, employeeId } });
const events = (paymentId: string) =>
  db.weeklyPaymentEvent.findMany({ where: { paymentId }, orderBy: { occurredAt: 'asc' } });

describe('sobres de un reparto cerrado', () => {
  it('un sobre por persona que participó, con los importes exactos del reparto cerrado', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const items = await db.dailyDistributionItem.findMany({
      where: { dailyDistribution: { settlementId } },
    });
    const payments = await db.weeklyPayment.findMany({ where: { settlementId } });
    // Carla (0 h) no participó: no tiene ítem ni sobre.
    expect(payments.map((p) => p.employeeId).sort()).toEqual([ids.Ana, ids.Beto].sort());
    for (const item of items) {
      const payment = payments.find((p) => p.employeeId === item.employeeId);
      expect(payment).toMatchObject({
        grossCents: item.amountCents,
        advancesCents: item.advancesCents,
        netCents: item.finalCents,
      });
    }
    // Ana: 30 h × 0,022 = 0,66; Beto 10 h × 0,022 = 0,22 → 75 % / 25 %; adelanto de $ 5.000.
    expect(await paymentOf(settlementId, ids.Ana)).toMatchObject({
      grossCents: 7_500_000n,
      advancesCents: 500_000n,
      netCents: 7_000_000n,
    });

    const view = await getEnvelopesView(db, await as(r.owner, CAN.viewEnvelopes), settlementId);
    expect(view?.envelopes.map((e) => [e.name, e.positionName, e.netCents, e.status])).toEqual([
      ['Ana', 'Salón', '7000000', 'PENDING'],
      ['Beto', 'Barra', '2500000', 'PENDING'],
    ]);
    expect(view).toMatchObject({ canHandle: true, canRevert: true, ownOnly: false });
  });

  it('preparar todos: guarda quién y cuándo; repetir no duplica ni recalcula', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const before = await db.weeklyPayment.findMany({ where: { settlementId } });

    expect(await prepare(r.owner, settlementId)).toEqual({
      ok: true,
      value: { prepared: 2, created: 0 },
    });
    expect(await prepare(r.owner, settlementId)).toEqual({
      ok: true,
      value: { prepared: 0, created: 0 },
    });

    const after = await db.weeklyPayment.findMany({ where: { settlementId } });
    expect(after).toHaveLength(2);
    for (const p of after) {
      const old = before.find((b) => b.id === p.id);
      expect(p).toMatchObject({
        status: 'PREPARED',
        preparedById: r.owner.id,
        grossCents: old?.grossCents,
        advancesCents: old?.advancesCents,
        netCents: old?.netCents,
      });
      expect(p.preparedAt).toBeInstanceOf(Date);
    }
    const ana = await paymentOf(settlementId, ids.Ana);
    expect((await events(ana.id)).map((e) => e.eventType)).toEqual(['CREATED', 'PREPARED']);
    // El adelanto se descontó una sola vez (en el cierre): sigue aplicado por $ 5.000.
    expect(
      await db.advanceApplication.aggregate({
        where: { advance: { restaurantId: r.id } },
        _sum: { amountCents: true },
      }),
    ).toMatchObject({ _sum: { amountCents: 500_000n } });
  });

  it('entregar: solo preparado, con quién y cuándo; después queda congelado', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const ana = await paymentOf(settlementId, ids.Ana);
    expect(await deliver(r.owner, ana.id)).toEqual({
      ok: false,
      error: 'Primero hay que preparar el sobre.',
    });
    await prepare(r.owner, settlementId, [ana.id]);
    expect(await deliver(r.owner, ana.id)).toEqual({ ok: true, value: { paymentId: ana.id } });
    expect(await deliver(r.owner, ana.id)).toEqual({
      ok: false,
      error: 'Ese sobre ya fue entregado.',
    });

    const delivered = await db.weeklyPayment.findUniqueOrThrow({ where: { id: ana.id } });
    expect(delivered).toMatchObject({ status: 'DELIVERED', deliveredById: r.owner.id });
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
    expect((await events(ana.id)).map((e) => e.eventType)).toEqual([
      'CREATED',
      'PREPARED',
      'DELIVERED',
    ]);
    expect(
      await db.auditLog.count({ where: { entityId: ana.id, action: 'envelope.delivered' } }),
    ).toBe(1);

    // Ni el importe ni la persona ni la entrega se pueden cambiar (trigger de la base).
    await expect(
      db.weeklyPayment.update({ where: { id: ana.id }, data: { netCents: 1n, grossCents: 1n } }),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      db.weeklyPayment.update({ where: { id: ana.id }, data: { deliveredAt: new Date(0) } }),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(db.weeklyPayment.delete({ where: { id: ana.id } })).rejects.toThrow(/IMMUTABLE/);
    // Deshacer la preparación de un entregado no aplica.
    expect(await undo(r.owner, ana.id)).toEqual({
      ok: false,
      error: 'Solo se puede deshacer la preparación de un sobre preparado.',
    });
  });

  it('deshacer la preparación exige motivo y deja el sobre limpio en Pendiente', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const beto = await paymentOf(settlementId, ids.Beto);
    await prepare(r.owner, settlementId, [beto.id]);
    expect(undoPreparationInput.safeParse({ paymentId: beto.id, reason: 'corto' }).success).toBe(
      false,
    );
    expect((await undo(r.owner, beto.id)).ok).toBe(true);
    expect(await db.weeklyPayment.findUniqueOrThrow({ where: { id: beto.id } })).toMatchObject({
      status: 'PENDING',
      preparedAt: null,
      preparedById: null,
    });
    expect((await events(beto.id)).at(-1)).toMatchObject({
      eventType: 'PREPARATION_UNDONE',
      reason: 'se armó con otra plata',
    });
  });

  it('revertir una entrega: motivo, Dueño/Encargado, historial completo', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const ana = await paymentOf(settlementId, ids.Ana);
    await prepare(r.owner, settlementId);
    await deliver(r.owner, ana.id);

    expect(revertDeliveryInput.safeParse({ paymentId: ana.id, reason: '' }).success).toBe(false);
    const manager = await member(r.id, 'MANAGER');
    expect(await revert(manager, ana.id)).toEqual({ ok: true, value: { paymentId: ana.id } });

    const reverted = await db.weeklyPayment.findUniqueOrThrow({ where: { id: ana.id } });
    expect(reverted).toMatchObject({
      status: 'PREPARED',
      deliveredAt: null,
      deliveredById: null,
      preparedById: r.owner.id,
      netCents: 7_000_000n,
    });
    const history = await events(ana.id);
    expect(history.map((e) => e.eventType)).toEqual([
      'CREATED',
      'PREPARED',
      'DELIVERED',
      'DELIVERY_REVERTED',
    ]);
    expect(history.at(-1)).toMatchObject({
      performedById: manager.id,
      authorizedById: manager.id,
      reason: 'se entregó a otra persona',
    });
    expect(
      await db.auditLog.count({
        where: { entityId: ana.id, action: 'envelope.delivery_reverted' },
      }),
    ).toBe(1);
    // Revertir algo no entregado no aplica; se puede volver a entregar.
    expect((await revert(r.owner, ana.id)).ok).toBe(false);
    expect((await deliver(manager, ana.id)).ok).toBe(true);
    // La bitácora no se edita ni se borra.
    await expect(
      db.weeklyPaymentEvent.deleteMany({ where: { paymentId: ana.id } }),
    ).rejects.toThrow(/IMMUTABLE/);
  });
});

describe('errores seguros', () => {
  it('reparto inexistente, abierto o anulado', async () => {
    const r = await restaurant();
    expect(await prepare(r.owner, randomUUID())).toEqual({
      ok: false,
      error: 'No se encontró ese reparto.',
    });
    expect(await deliver(r.owner, randomUUID())).toEqual({
      ok: false,
      error: 'No se encontró ese sobre.',
    });

    const open = await startPeriod(
      db,
      await as(r.owner, CAN.editPeriod),
      startPeriodInput.parse({ date: '2025-03-05' }),
    );
    if (!open.ok) throw new Error(open.error);
    expect(await prepare(r.owner, open.value.settlementId)).toEqual({
      ok: false,
      error: 'Este reparto todavía no está cerrado: los sobres se generan al cerrarlo.',
    });
    expect(await getEnvelopesView(db, await as(r.owner), open.value.settlementId)).toBeNull();
  });

  it('un reparto anulado no genera ni cambia sobres', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const ana = await paymentOf(settlementId, ids.Ana);
    await prepare(r.owner, settlementId, [ana.id]);
    await db.$executeRaw`
      UPDATE weekly_settlements
      SET status = 'VOIDED', voided_at = now(), voided_by = ${r.owner.id}::uuid,
          void_reason = 'anulado para corregir en el test'
      WHERE id = ${settlementId}::uuid`;
    const voided = 'Este reparto fue anulado: sus sobres no se pueden modificar.';
    expect(await prepare(r.owner, settlementId)).toEqual({ ok: false, error: voided });
    expect(await deliver(r.owner, ana.id)).toEqual({ ok: false, error: voided });
    expect(await undo(r.owner, ana.id)).toEqual({ ok: false, error: voided });
    const view = await getEnvelopesView(db, await as(r.owner), settlementId);
    expect(view).toMatchObject({ status: 'VOIDED', canHandle: false, canRevert: false });
  });
});

describe('permisos', () => {
  it('Encargado prepara y entrega; Lector solo mira', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const manager = await member(r.id, 'MANAGER');
    const viewer = await member(r.id, 'VIEWER');
    expect((await prepare(manager, settlementId)).ok).toBe(true);
    expect((await deliver(manager, (await paymentOf(settlementId, ids.Beto)).id)).ok).toBe(true);

    await expect(as(viewer, CAN.handleEnvelopes)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    await expect(as(viewer, CAN.revertDelivery)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    const view = await getEnvelopesView(db, await as(viewer, CAN.viewEnvelopes), settlementId);
    expect(view).toMatchObject({ canHandle: false, canRevert: false });
    expect(view?.envelopes).toHaveLength(2);
  });

  it('Editor: según la política del período (solo Encargado / Encargado y Editor); nunca revierte', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const editor = await member(r.id, 'EDITOR');
    const beto = await paymentOf(settlementId, ids.Beto);
    // Política estándar: solo el Encargado maneja sobres.
    await expect(prepare(editor, settlementId)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    await expect(deliver(editor, beto.id)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    expect((await getEnvelopesView(db, await as(editor), settlementId))?.canHandle).toBe(false);
    expect(await db.weeklyPayment.count({ where: { settlementId, status: 'PENDING' } })).toBe(2);

    // Con "Encargado y Editor" (la versión del período nuevo), el Editor prepara y entrega.
    const r2 = await restaurant('Con editor');
    const changed = await changePolicy(
      db,
      { restaurantId: r2.id, userId: r2.owner.id },
      { kind: 'value', key: 'envelopes', value: 'ENCARGADO_Y_EDITOR' },
    );
    expect(changed.ok).toBe(true);
    const second = await closedPeriod(r2);
    const editor2 = await member(r2.id, 'EDITOR');
    expect((await prepare(editor2, second.settlementId)).ok).toBe(true);
    const ana2 = await paymentOf(second.settlementId, second.ids.Ana);
    expect((await deliver(editor2, ana2.id)).ok).toBe(true);
    await expect(as(editor2, CAN.revertDelivery)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
  });

  it('SELF ve solo su sobre, no el de los demás, y no opera', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const self = await member(r.id, 'SELF', ids.Beto);
    const access = await as(self, CAN.viewEnvelopes);
    const view = await getEnvelopesView(db, access, settlementId);
    expect(view?.ownOnly).toBe(true);
    expect(view?.envelopes.map((e) => e.name)).toEqual(['Beto']);
    expect(view?.envelopes[0]?.events.every((e) => e.type !== undefined)).toBe(true);
    const periods = await listEnvelopePeriods(db, access);
    expect(periods).toMatchObject([{ settlementId, total: 1, toDeliverCents: '2500000' }]);
    await expect(as(self, CAN.handleEnvelopes)).rejects.toMatchObject({ reason: 'FORBIDDEN' });

    // Carla (SELF sin sobre en ese reparto) no ve nada de ese reparto.
    const carla = await member(r.id, 'SELF', ids.Carla);
    const carlaView = await getEnvelopesView(db, await as(carla), settlementId);
    expect(carlaView?.envelopes).toEqual([]);
    expect(await listEnvelopePeriods(db, await as(carla))).toEqual([]);
  });
});

describe('aislamiento y concurrencia', () => {
  it('otro restaurante no ve ni opera sobres ajenos (ids manipulados)', async () => {
    const r = await restaurant('A');
    const { ids, settlementId } = await closedPeriod(r);
    const other = await restaurant('B');
    const ana = await paymentOf(settlementId, ids.Ana);

    expect(await prepare(other.owner, settlementId)).toEqual({
      ok: false,
      error: 'No se encontró ese reparto.',
    });
    expect(await prepare(other.owner, settlementId, [ana.id])).toEqual({
      ok: false,
      error: 'No se encontró ese reparto.',
    });
    expect(await deliver(other.owner, ana.id)).toEqual({
      ok: false,
      error: 'No se encontró ese sobre.',
    });
    expect(await revert(other.owner, ana.id)).toEqual({
      ok: false,
      error: 'No se encontró ese sobre.',
    });
    expect(await getEnvelopesView(db, await as(other.owner), settlementId)).toBeNull();
    expect(await listEnvelopePeriods(db, await as(other.owner))).toEqual([]);

    // Un sobre de otro reparto (aunque sea del mismo dueño) no entra por este reparto.
    const otherClosed = await closedPeriod(other);
    const foreign = await paymentOf(otherClosed.settlementId, otherClosed.ids.Ana);
    expect(await prepare(r.owner, settlementId, [foreign.id])).toEqual({
      ok: false,
      error: 'No se encontró ese sobre.',
    });
    expect((await db.weeklyPayment.findUniqueOrThrow({ where: { id: ana.id } })).status).toBe(
      'PENDING',
    );
  });

  it('"Preparar todos" y una entrega al mismo tiempo: se ordenan, sin deadlock', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const manager = await member(r.id, 'MANAGER');
    const beto = await paymentOf(settlementId, ids.Beto);
    await prepare(r.owner, settlementId, [beto.id]);
    for (let round = 0; round < 3; round += 1) {
      const [all, one] = await Promise.all([
        prepare(manager, settlementId),
        round === 0
          ? deliver(r.owner, beto.id)
          : revert(r.owner, beto.id, 'prueba de concurrencia'),
      ]);
      expect(all.ok).toBe(true);
      expect(one.ok).toBe(true);
      if (round === 1) expect((await deliver(r.owner, beto.id)).ok).toBe(true);
      if (round === 1) break;
    }
    const statuses = (await db.weeklyPayment.findMany({ where: { settlementId } })).map(
      (p) => p.status,
    );
    expect(statuses.sort()).toEqual(['DELIVERED', 'PREPARED']);
  });

  it('dos personas preparando y entregando a la vez: sin duplicados ni estados imposibles', async () => {
    const r = await restaurant();
    const { ids, settlementId } = await closedPeriod(r);
    const manager = await member(r.id, 'MANAGER');

    const [a, b] = await Promise.all([
      prepare(r.owner, settlementId),
      prepare(manager, settlementId),
    ]);
    const prepared = [a, b].map((x) => (x.ok ? x.value.prepared : -1)).sort();
    expect(prepared).toEqual([0, 2]);
    expect(
      await db.weeklyPaymentEvent.count({
        where: { eventType: 'PREPARED', payment: { settlementId } },
      }),
    ).toBe(2);

    const ana = await paymentOf(settlementId, ids.Ana);
    const both = await Promise.all([deliver(r.owner, ana.id), deliver(manager, ana.id)]);
    expect(both.filter((x) => x.ok)).toHaveLength(1);
    expect(both.find((x) => !x.ok)).toEqual({ ok: false, error: 'Ese sobre ya fue entregado.' });
    expect(
      await db.weeklyPaymentEvent.count({ where: { paymentId: ana.id, eventType: 'DELIVERED' } }),
    ).toBe(1);
  });
});
