import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { authorize, type AccessContext } from '@/server/access/access';
import { CAN, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import {
  deliverEnvelopeInput,
  prepareEnvelopesInput,
  revertDeliveryInput,
} from '@/server/envelopes/schemas';
import { deliverEnvelope, prepareEnvelopes, revertDelivery } from '@/server/envelopes/service';
import { getHistoryDetail, listHistory } from '@/server/history/repository';
import { parseHistoryFilters } from '@/lib/history/filters';
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
 * Historial (solo lectura) contra PostgreSQL real, con el mismo código que las páginas:
 * `authorize` (lo que ejecuta requireAccess) → repositorio. Nada de esto escribe.
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
  const ids: Record<'Ana' | 'Beto' | 'Carla', string> = { Ana: '', Beto: '', Carla: '' };
  for (const [name, puesto] of [
    ['Ana', 'Salón'],
    ['Beto', 'Barra'],
    ['Carla', 'Bacha'],
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

const viewer = (user: SessionUser): Promise<AccessContext> =>
  authorize(db, user, { roles: CAN.viewHistory });

/**
 * Reparto de la semana de `date`: $ 100.000 entre Ana (Salón 30 h, adelanto $ 5.000) y Beto
 * (Barra 10 h); Carla (Bacha) no trabajó y tiene un adelanto de $ 2.000 que queda pendiente.
 * Con `close = false` queda abierto.
 */
async function period(r: R, date: string, close = true, total = '100.000') {
  const edit = await authorize(db, r.owner, { roles: CAN.editPeriod });
  const started = await startPeriod(db, edit, startPeriodInput.parse({ date }));
  if (!started.ok) throw new Error(started.error);
  const settlementId = started.value.settlementId;
  await setPeriodTips(db, edit, setTipsInput.parse({ mode: 'total', settlementId, total }));
  await setPeriodHours(
    db,
    edit,
    setHoursInput.parse({
      settlementId,
      entries: [
        { employeeId: r.ids.Ana, hours: '30' },
        { employeeId: r.ids.Beto, hours: '10' },
        { employeeId: r.ids.Carla, hours: '0' },
      ],
    }),
  );
  for (const [employeeId, amount] of [
    [r.ids.Ana, '5.000'],
    [r.ids.Carla, '2.000'],
  ] as const) {
    const added = await addPeriodAdvance(
      db,
      edit,
      addAdvanceInput.parse({ settlementId, employeeId, date, amount, note: '' }),
    );
    if (!added.ok) throw new Error(added.error);
  }
  if (close) {
    const closed = await closePeriod(
      db,
      await authorize(db, r.owner, { roles: CAN.closePeriod }),
      closePeriodInput.parse({ settlementId }),
    );
    if (!closed.ok) throw new Error(closed.error);
  }
  return settlementId;
}

const all = parseHistoryFilters({});

describe('historial: lista', () => {
  it('solo repartos cerrados/anulados del restaurante, del más nuevo al más viejo', async () => {
    const r = await restaurant();
    const older = await period(r, '2025-04-02');
    const newer = await period(r, '2025-04-09');
    await period(r, '2025-04-16', false); // abierto: no es historial
    const list = await listHistory(db, await viewer(r.owner), all);
    expect(list.items.map((i) => i.settlementId)).toEqual([newer, older]);
    expect(list.items[0]).toMatchObject({
      weekStart: '2025-04-07',
      weekEnd: '2025-04-13',
      status: 'CLOSED',
      closedBy: 'Dueño',
      totalCents: '10000000',
      participants: 2,
      envelopes: 2,
      delivered: 0,
      // Ana 75.000 − 5.000 + Beto 25.000
      toDeliverCents: '9500000',
    });
    expect(list.hasMore).toBe(false);
  });

  it('filtros: estado, rango de semanas y persona', async () => {
    const r = await restaurant();
    const a = await period(r, '2025-05-07');
    const b = await period(r, '2025-05-14');
    await db.$executeRaw`
      UPDATE weekly_settlements
      SET status = 'VOIDED', voided_at = now(), voided_by = ${r.owner.id}::uuid,
          void_reason = 'se cargó mal la propina'
      WHERE id = ${a}::uuid`;
    const as = await viewer(r.owner);
    const ids = async (params: Record<string, string>) =>
      (await listHistory(db, as, parseHistoryFilters(params))).items.map((i) => i.settlementId);
    expect(await ids({ estado: 'VOIDED' })).toEqual([a]);
    expect(await ids({ estado: 'CLOSED' })).toEqual([b]);
    expect(await ids({ desde: '2025-05-10' })).toEqual([b]);
    expect(await ids({ hasta: '2025-05-10' })).toEqual([a]);
    expect(await ids({ persona: 'bet' })).toEqual([b, a]);
    // Carla no participó (0 h): no aparece por su nombre.
    expect(await ids({ persona: 'Carla' })).toEqual([]);
  });
});

describe('historial: detalle', () => {
  it('muestra los valores guardados aunque después cambie la política (no recalcula)', async () => {
    const r = await restaurant();
    const settlementId = await period(r, '2025-06-04');
    const before = await getHistoryDetail(db, await viewer(r.owner), settlementId);

    // Después del cierre, Salón pasa de 0,022 a 0,030 (versión 2).
    const changed = await changePolicy(
      db,
      { restaurantId: r.id, userId: r.owner.id },
      { kind: 'portion', positionId: r.positions.Salón, factor: '0,030' },
    );
    expect(changed.ok).toBe(true);

    const after = await getHistoryDetail(db, await viewer(r.owner), settlementId);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      status: 'CLOSED',
      policyNumber: 1,
      roundingUnit: 'CENT',
      calcVersion: 'provisional-1',
      totals: {
        tipsCents: '10000000',
        advancesCents: '500000',
        finalCents: '9500000',
        pointsE6: '880000',
        participants: 2,
      },
      detailAvailable: true,
    });
    expect(after?.people).toEqual([
      {
        employeeId: r.ids.Ana,
        name: 'Ana',
        positionName: 'Salón',
        hours: '30',
        factor: '0,022',
        // BY_POSITION: los puntos individuales no intervinieron (null en el snapshot).
        individualPoints: null,
        weightE8: '66000000',
        pointsE6: '660000',
        percentE2: '7500',
        grossCents: '7500000',
        advancesCents: '500000',
        finalCents: '7000000',
        envelope: { paymentId: expect.any(String), status: 'PENDING', reverted: false },
      },
      {
        employeeId: r.ids.Beto,
        name: 'Beto',
        positionName: 'Barra',
        hours: '10',
        factor: '0,022',
        individualPoints: null,
        weightE8: '22000000',
        pointsE6: '220000',
        percentE2: '2500',
        grossCents: '2500000',
        advancesCents: '0',
        finalCents: '2500000',
        envelope: { paymentId: expect.any(String), status: 'PENDING', reverted: false },
      },
    ]);
  });

  it('adelantos: registrado, descontado en este reparto y pendiente (sin volver a descontar)', async () => {
    const r = await restaurant();
    const settlementId = await period(r, '2025-06-11');
    const detail = await getHistoryDetail(db, await viewer(r.owner), settlementId);
    expect(
      detail?.advances.map((a) => [
        a.employeeName,
        a.amountCents,
        a.appliedHereCents,
        a.pendingNowCents,
        a.status,
      ]),
    ).toEqual([
      ['Ana', '500000', '500000', '0', 'APPLIED'],
      ['Carla', '200000', '0', '200000', 'PENDING'],
    ]);
    // Consultar no cambia nada.
    await getHistoryDetail(db, await viewer(r.owner), settlementId);
    expect(await db.advanceApplication.count({ where: { advance: { restaurantId: r.id } } })).toBe(
      1,
    );
  });

  it('sobres y actividad: preparado, entregado, revertido (con motivo) y cierre', async () => {
    const r = await restaurant();
    const settlementId = await period(r, '2025-06-18');
    const handle = await authorize(db, r.owner, { roles: CAN.handleEnvelopes });
    await prepareEnvelopes(db, handle, prepareEnvelopesInput.parse({ settlementId }));
    const ana = await db.weeklyPayment.findFirstOrThrow({
      where: { settlementId, employeeId: r.ids.Ana },
    });
    await deliverEnvelope(db, handle, deliverEnvelopeInput.parse({ paymentId: ana.id }));
    await revertDelivery(
      db,
      await authorize(db, r.owner, { roles: CAN.revertDelivery }),
      revertDeliveryInput.parse({ paymentId: ana.id, reason: 'se entregó a otra persona' }),
    );
    await deliverEnvelope(db, handle, deliverEnvelopeInput.parse({ paymentId: ana.id }));

    const detail = await getHistoryDetail(db, await viewer(r.owner), settlementId);
    expect(detail?.people.find((p) => p.name === 'Ana')?.envelope).toMatchObject({
      status: 'DELIVERED',
      reverted: true,
    });
    const kinds = detail?.events.map((e) => [e.kind, e.employeeName, e.reason]);
    expect(kinds?.[0]).toEqual(['CLOSED', null, null]);
    expect(kinds).toContainEqual(['DELIVERY_REVERTED', 'Ana', 'se entregó a otra persona']);
    expect(kinds?.filter((k) => k[0] === 'DELIVERED')).toHaveLength(2);
    expect(kinds?.filter((k) => k[0] === 'PREPARED')).toHaveLength(2);
    const list = await listHistory(db, await viewer(r.owner), all);
    expect(list.items[0]).toMatchObject({ delivered: 1, toDeliverCents: '2500000' });
  });

  it('anulado: se muestra como tal, conserva todo y no permite nada', async () => {
    const r = await restaurant();
    const settlementId = await period(r, '2025-06-25');
    const before = await getHistoryDetail(db, await viewer(r.owner), settlementId);
    // Como la anulación real (DATABASE.md §6): el reparto diario se desvincula y el período se anula.
    await db.$executeRaw`
      UPDATE daily_distributions SET settlement_id = NULL WHERE settlement_id = ${settlementId}::uuid`;
    await db.$executeRaw`
      UPDATE weekly_settlements
      SET status = 'VOIDED', voided_at = now(), voided_by = ${r.owner.id}::uuid,
          void_reason = 'propina mal cargada, se rehace'
      WHERE id = ${settlementId}::uuid`;
    const detail = await getHistoryDetail(db, await viewer(r.owner), settlementId);
    expect(detail).toMatchObject({
      status: 'VOIDED',
      voidedBy: 'Dueño',
      voidReason: 'propina mal cargada, se rehace',
      detailAvailable: true,
      totals: before?.totals,
    });
    expect(detail?.people.map((p) => [p.name, p.finalCents, p.pointsE6])).toEqual(
      before?.people.map((p) => [p.name, p.finalCents, p.pointsE6]),
    );
    expect(detail?.events.at(-1)).toMatchObject({
      kind: 'VOIDED',
      reason: 'propina mal cargada, se rehace',
    });
  });

  it('inexistente, abierto o de otro restaurante: no existe (sin filtrar datos)', async () => {
    const r = await restaurant('A');
    const closed = await period(r, '2025-07-02');
    const open = await period(r, '2025-07-09', false);
    const as = await viewer(r.owner);
    expect(await getHistoryDetail(db, as, randomUUID())).toBeNull();
    expect(await getHistoryDetail(db, as, open)).toBeNull();

    const other = await restaurant('B');
    const otherAccess = await viewer(other.owner);
    expect(await getHistoryDetail(db, otherAccess, closed)).toBeNull();
    expect((await listHistory(db, otherAccess, all)).items).toEqual([]);
    // Buscar por nombre de una persona de A tampoco devuelve nada en B.
    expect(
      (await listHistory(db, otherAccess, parseHistoryFilters({ persona: 'Ana' }))).items,
    ).toEqual([]);
  });
});

describe('historial: permisos', () => {
  it('Dueño, Encargado, Editor y Lector ven todo el restaurante', async () => {
    const r = await restaurant();
    const settlementId = await period(r, '2025-08-06');
    const full = await getHistoryDetail(db, await viewer(r.owner), settlementId);
    expect(full?.canVoid).toBe(true);
    for (const role of ['MANAGER', 'EDITOR', 'VIEWER'] as const) {
      const user = await member(r.id, role);
      const detail = await getHistoryDetail(db, await viewer(user), settlementId);
      // Todos ven lo mismo; solo Dueño/Encargado pueden anular.
      expect({ role, detail }).toEqual({
        role,
        detail: { ...full, canVoid: role === 'MANAGER', canRedo: false },
      });
      expect((await listHistory(db, await viewer(user), all)).items).toHaveLength(1);
    }
  });

  it('SELF ve solo lo suyo: sin totales, sin otras personas, sin adelantos ajenos', async () => {
    const r = await restaurant();
    const settlementId = await period(r, '2025-08-13');
    const beto = await member(r.id, 'SELF', r.ids.Beto);
    const access = await viewer(beto);

    const list = await listHistory(db, access, parseHistoryFilters({ persona: 'Ana' }));
    expect(list.ownOnly).toBe(true);
    // El filtro por persona no aplica a SELF: siempre es él mismo.
    expect(list.items).toEqual([
      expect.objectContaining({ settlementId, totalCents: '2500000', participants: null }),
    ]);

    const detail = await getHistoryDetail(db, access, settlementId);
    expect(detail).toMatchObject({ ownOnly: true, totals: null });
    expect(detail?.people.map((p) => p.name)).toEqual(['Beto']);
    expect(detail?.advances).toEqual([]);
    expect(detail?.events.every((e) => e.employeeName === null || e.employeeName === 'Beto')).toBe(
      true,
    );
    expect(detail?.events.find((e) => e.kind === 'CLOSED')?.amountCents).toBeNull();

    // Carla (SELF) no participó: para ella ese reparto no existe; ve solo su adelanto pendiente en otro lado.
    const carla = await member(r.id, 'SELF', r.ids.Carla);
    expect(await getHistoryDetail(db, await viewer(carla), settlementId)).toBeNull();
    expect((await listHistory(db, await viewer(carla), all)).items).toEqual([]);
  });
});
