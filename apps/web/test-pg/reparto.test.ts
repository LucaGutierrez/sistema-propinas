import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AccessDenied, authorize, type AccessContext } from '@/server/access/access';
import { CAN, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import { getHistoryDetail } from '@/server/history/repository';
import {
  getClosedPeriodView,
  getOpenPeriodView,
  getPeriodOverview,
} from '@/server/periods/repository';
import {
  addAdvanceInput,
  closePeriodInput,
  setHoursInput,
  setTipsInput,
  startPeriodInput,
} from '@/server/periods/schemas';
import {
  addPeriodAdvance,
  CALC_VERSION,
  closePeriod,
  setPeriodHours,
  setPeriodTips,
  startPeriod,
} from '@/server/periods/service';
import { bootstrapRestaurant } from '@/server/policy/service';
import { addEmployee } from '@/server/staff/service';

/*
 * "Repartir propinas" de punta a punta contra PostgreSQL real (con todos los triggers), con el
 * mismo código que la página y las acciones: `authorize` (lo que ejecuta requireAccess) → Zod →
 * servicio / repositorio.
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

async function member(restaurantId: string, role: Exclude<Role, 'OWNER' | 'SELF'>) {
  const email = `u-${randomUUID()}@example.invalid`;
  const user = await db.user.create({ data: { email, name: role } });
  await db.membership.create({ data: { userId: user.id, restaurantId, role } });
  return { id: user.id, email, name: role } satisfies SessionUser;
}

const as = (user: SessionUser, roles: readonly Role[]): Promise<AccessContext> =>
  authorize(db, user, { roles });

async function staff(r: Awaited<ReturnType<typeof restaurant>>, people: [string, Puesto][]) {
  const access = await as(r.owner, CAN.manageStaff);
  const ids: Record<string, string> = {};
  for (const [name, puesto] of people) {
    const result = await addEmployee(db, access, { name, positionId: r.positions[puesto] });
    if (!result.ok) throw new Error(result.error);
    ids[name] = result.value.employeeId;
  }
  return ids;
}

const LIBRARY: [string, Puesto, string][] = [
  ['Ivan', 'Supervisor', '45'],
  ['Nardelli', 'Supervisor', '18'],
  ['Roro', 'Barra', '45'],
  ['Marcos', 'Barra', '13'],
  ['Leo', 'Salón', '54'],
  ['Isaías', 'Salón', '36'],
  ['Agus Fulleda', 'Salón', '32'],
  ['Cami noche', 'Salón', '5'],
  ['Agus noche', 'Salón', '5'],
  ['Nahuel', 'Bacha', '24'],
  ['Jesús', 'Bacha', '20'],
  ['Jean', 'Bacha', '4'],
];

/** Una semana pasada: 2025-01-06 (lunes) al 2025-01-12. */
const DAY = '2025-01-08';
const WEEK_START = '2025-01-06';

async function start(user: SessionUser, date = DAY): Promise<string> {
  const result = await startPeriod(
    db,
    await as(user, CAN.editPeriod),
    startPeriodInput.parse({ date }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value.settlementId;
}

const tips = async (user: SessionUser, settlementId: string, total: string) =>
  setPeriodTips(
    db,
    await as(user, CAN.editPeriod),
    setTipsInput.parse({ mode: 'total', settlementId, total }),
  );

const hours = async (
  user: SessionUser,
  settlementId: string,
  entries: { employeeId: string; hours: string | null }[],
) =>
  setPeriodHours(
    db,
    await as(user, CAN.editPeriod),
    setHoursInput.parse({ settlementId, entries }),
  );

const close = async (user: SessionUser, settlementId: string) =>
  closePeriod(db, await as(user, CAN.closePeriod), closePeriodInput.parse({ settlementId }));

async function libraryReady() {
  const r = await restaurant('Library');
  const ids = await staff(
    r,
    LIBRARY.map(([name, puesto]) => [name, puesto]),
  );
  const settlementId = await start(r.owner);
  expect((await tips(r.owner, settlementId, '347.990')).ok).toBe(true);
  const saved = await hours(
    r.owner,
    settlementId,
    LIBRARY.map(([name, , h]) => ({ employeeId: ids[name] as string, hours: h })),
  );
  expect(saved.ok).toBe(true);
  return { r, ids, settlementId };
}

describe('empezar un reparto', () => {
  it('abre el período de la semana (según la configuración) y su reparto en borrador', async () => {
    const r = await restaurant();
    const settlementId = await start(r.owner);
    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement.status).toBe('OPEN');
    expect(settlement.weekStart.toISOString().slice(0, 10)).toBe(WEEK_START);
    expect(settlement.weekEnd.toISOString().slice(0, 10)).toBe('2025-01-12');
    const current = await db.restaurant.findUniqueOrThrow({ where: { id: r.id } });
    expect(settlement.policyVersionId).toBe(current.currentPolicyVersionId);
    expect(
      await db.dailyDistribution.count({
        where: { restaurantId: r.id, scope: 'PERIOD', status: 'DRAFT' },
      }),
    ).toBe(1);
    // Un reparto a la vez: empezar de nuevo sigue con el abierto.
    expect(await start(r.owner, '2025-01-01')).toBe(settlementId);
    expect(await db.weeklySettlement.count({ where: { restaurantId: r.id } })).toBe(1);
  });

  it('no deja empezar una semana futura', async () => {
    const r = await restaurant();
    const result = await startPeriod(
      db,
      await as(r.owner, CAN.editPeriod),
      startPeriodInput.parse({ date: '2099-01-01' }),
    );
    expect(result).toEqual({
      ok: false,
      error: 'No se puede empezar un reparto de una semana futura.',
    });
  });

  it('la pantalla muestra el período vacío con el personal activo, sin horas cargadas', async () => {
    const r = await restaurant();
    await staff(r, [
      ['Ana', 'Salón'],
      ['Beto', 'Barra'],
    ]);
    await start(r.owner);
    const view = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(view).toMatchObject({
      weekStart: WEEK_START,
      policyVersion: 1,
      roundingUnit: 'CENT',
      tips: { mode: 'total', totalCents: '0' },
      canEdit: true,
      canClose: true,
    });
    // Agrupadas por puesto, en el orden de la configuración (Barra antes que Salón).
    expect(view?.people.map((p) => [p.name, p.positionName, p.factor, p.hours])).toEqual([
      ['Beto', 'Barra', '0,022', null],
      ['Ana', 'Salón', '0,022', null],
    ]);
  });
});

describe('cargar propina y horas', () => {
  it('guarda el total, las horas (también 0) y vuelve a "sin cargar" al borrar', async () => {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Ana', 'Salón'],
      ['Beto', 'Barra'],
    ]);
    const settlementId = await start(r.owner);
    expect(await tips(r.owner, settlementId, '100.000')).toEqual({
      ok: true,
      value: { totalCents: 10_000_000n },
    });
    // Corregir la propina reemplaza el total anterior.
    await tips(r.owner, settlementId, '120.500,50');
    expect(
      (
        await hours(r.owner, settlementId, [
          { employeeId: ids.Ana as string, hours: '8,5' },
          { employeeId: ids.Beto as string, hours: '0' },
        ])
      ).ok,
    ).toBe(true);
    let view = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(view?.tips).toEqual({
      mode: 'total',
      totalCents: '12050050',
      days: [{ date: '2025-01-12', amountCents: '12050050' }],
    });
    expect(Object.fromEntries(view?.people.map((p) => [p.name, p.hours]) ?? [])).toEqual({
      Ana: '8,5',
      Beto: '0',
    });

    await hours(r.owner, settlementId, [{ employeeId: ids.Beto as string, hours: null }]);
    view = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(view?.people.find((p) => p.name === 'Beto')?.hours).toBeNull();
  });

  it('propina por día: se guarda cada día y el total es la suma', async () => {
    const r = await restaurant();
    const settlementId = await start(r.owner);
    const result = await setPeriodTips(
      db,
      await as(r.owner, CAN.editPeriod),
      setTipsInput.parse({
        mode: 'daily',
        settlementId,
        days: [
          { date: '2025-01-06', amount: '45.000' },
          { date: '2025-01-07', amount: '' },
          { date: '2025-01-11', amount: '52.000' },
        ],
      }),
    );
    expect(result).toEqual({ ok: true, value: { totalCents: 9_700_000n } });
    const view = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(view?.tips.mode).toBe('daily');
    expect(view?.tips.days).toEqual([
      { date: '2025-01-06', amountCents: '4500000' },
      { date: '2025-01-11', amountCents: '5200000' },
    ]);
    // Un día fuera del período se rechaza.
    const outside = await setPeriodTips(
      db,
      await as(r.owner, CAN.editPeriod),
      setTipsInput.parse({
        mode: 'daily',
        settlementId,
        days: [{ date: '2025-01-13', amount: '1' }],
      }),
    );
    expect(outside).toEqual({ ok: false, error: 'Ese día no es de este período.' });
  });

  it('rechaza horas inválidas antes de llegar a la base', () => {
    expect(
      setHoursInput.safeParse({
        settlementId: randomUUID(),
        entries: [{ employeeId: randomUUID(), hours: '169' }],
      }).success,
    ).toBe(false);
  });
});

describe('cerrar el reparto', () => {
  it('caso Library: cierra con el motor, suma exacta, sobres y snapshot', async () => {
    const { r, ids, settlementId } = await libraryReady();
    const result = await close(r.owner, settlementId);
    expect(result).toEqual({
      ok: true,
      value: {
        settlementId,
        totalCents: 34_799_000n,
        totalFinalCents: 34_799_000n,
        payments: 12,
      },
    });

    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement).toMatchObject({
      status: 'CLOSED',
      calcVersion: CALC_VERSION,
      totalCents: 34_799_000n,
      totalAdvancesCents: 0n,
      totalFinalCents: 34_799_000n,
      closedById: r.owner.id,
    });
    expect(settlement.policySnapshot).toMatchObject({ number: 1, roundingUnit: 'CENT' });

    const payments = await db.weeklyPayment.findMany({ where: { settlementId } });
    const net = Object.fromEntries(payments.map((p) => [p.employeeNameSnapshot, p.netCents]));
    expect(net).toMatchObject({ Ivan: 4_061_388n, Leo: 7_658_617n, Jean: 180_506n });
    expect(payments.reduce((sum, p) => sum + p.netCents, 0n)).toBe(34_799_000n);
    expect(payments.every((p) => p.status === 'PENDING')).toBe(true);
    expect(await db.weeklyPaymentEvent.count({ where: { restaurantId: r.id } })).toBe(12);

    const distribution = await db.dailyDistribution.findFirstOrThrow({
      where: { settlementId },
      include: { items: true },
    });
    expect(distribution.status).toBe('CLOSED');
    expect(distribution.totalPoints.toFixed(6)).toBe('5.398000');
    const ivan = distribution.items.find((i) => i.employeeId === ids.Ivan);
    expect(ivan?.hours.toFixed(2)).toBe('45.00');
    expect(ivan?.portionSnapshot.toFixed(3)).toBe('0.014');
    expect(ivan?.points.toFixed(3)).toBe('0.630');
    expect(ivan?.amountCents).toBe(4_061_388n);

    const detail = await getClosedPeriodView(db, r.id, settlementId);
    expect(detail).toMatchObject({
      status: 'CLOSED',
      totalCents: '34799000',
      totalPointsE6: '5398000',
      totalHours: '30100',
    });
    expect(detail?.rows.find((row) => row.name === 'Ivan')).toMatchObject({
      hours: '45',
      factor: '0,014',
      pointsE6: '630000',
      percentE2: '1167',
      finalCents: '4061388',
      paymentStatus: 'PENDING',
    });
    // Porcentaje guardado 0,220082 → 22,01 % (redondeo, no truncado), también en el historial.
    expect(detail?.rows.find((row) => row.name === 'Leo')?.percentE2).toBe('2201');
    const history = await getHistoryDetail(db, await as(r.owner, CAN.viewHistory), settlementId);
    expect(history?.people.find((p) => p.name === 'Leo')?.percentE2).toBe('2201');
    expect(history?.people.find((p) => p.name === 'Marcos')?.percentE2).toBe('530');
    // Ya no hay reparto abierto; el inicio lo lista entre los cerrados.
    expect(await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods))).toBeNull();
    const overview = await getPeriodOverview(db, r.id);
    expect(overview.open).toBeNull();
    expect(overview.recent.map((p) => p.settlementId)).toEqual([settlementId]);
  });

  it('no cierra si falta la propina o las horas de alguien (0 sí vale)', async () => {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Ana', 'Salón'],
      ['Beto', 'Barra'],
    ]);
    const settlementId = await start(r.owner);
    expect(await close(r.owner, settlementId)).toMatchObject({ ok: false });

    await tips(r.owner, settlementId, '10.000');
    await hours(r.owner, settlementId, [{ employeeId: ids.Ana as string, hours: '8' }]);
    expect(await close(r.owner, settlementId)).toEqual({
      ok: false,
      error: 'Falta cargar las horas de Beto. Si no trabajó, poné 0.',
    });
    expect(
      (await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } })).status,
    ).toBe('OPEN');

    await hours(r.owner, settlementId, [{ employeeId: ids.Beto as string, hours: '0' }]);
    const closed = await close(r.owner, settlementId);
    expect(closed).toMatchObject({ ok: true, value: { payments: 1, totalFinalCents: 1_000_000n } });
    const detail = await getClosedPeriodView(db, r.id, settlementId);
    expect(detail?.withoutHours).toEqual(['Beto']);
  });

  it('todos con 0 horas: no se puede cerrar', async () => {
    const r = await restaurant();
    const ids = await staff(r, [['Ana', 'Salón']]);
    const settlementId = await start(r.owner);
    await tips(r.owner, settlementId, '10.000');
    await hours(r.owner, settlementId, [{ employeeId: ids.Ana as string, hours: '0' }]);
    expect(await close(r.owner, settlementId)).toEqual({
      ok: false,
      error: 'Nadie tiene horas trabajadas: cargá las horas para repartir.',
    });
  });

  it('descuenta adelantos; lo que no alcanza queda pendiente para el próximo reparto', async () => {
    const { r, ids, settlementId } = await libraryReady();
    const access = await as(r.owner, CAN.editPeriod);
    const leo = await addPeriodAdvance(
      db,
      access,
      addAdvanceInput.parse({
        settlementId,
        employeeId: ids.Leo,
        date: '2025-01-11',
        amount: '10.000',
        note: 'Adelanto de la planilla',
      }),
    );
    const jean = await addPeriodAdvance(
      db,
      access,
      addAdvanceInput.parse({
        settlementId,
        employeeId: ids.Jean,
        date: '2025-01-11',
        amount: '5.000',
        note: '',
      }),
    );
    expect(leo.ok && jean.ok).toBe(true);
    const outside = await addPeriodAdvance(
      db,
      access,
      addAdvanceInput.parse({
        settlementId,
        employeeId: ids.Leo,
        date: '2025-01-20',
        amount: '1',
        note: '',
      }),
    );
    expect(outside).toEqual({
      ok: false,
      error: 'La fecha del adelanto tiene que ser de este período.',
    });

    const view = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(view?.people.find((p) => p.name === 'Leo')?.advanceCents).toBe('1000000');

    expect(await close(r.owner, settlementId)).toMatchObject({
      ok: true,
      value: { totalCents: 34_799_000n, totalFinalCents: 34_799_000n - 1_000_000n - 180_506n },
    });
    const payments = await db.weeklyPayment.findMany({ where: { settlementId } });
    expect(payments.find((p) => p.employeeNameSnapshot === 'Leo')).toMatchObject({
      grossCents: 7_658_617n,
      advancesCents: 1_000_000n,
      netCents: 6_658_617n,
    });
    expect(payments.find((p) => p.employeeNameSnapshot === 'Jean')).toMatchObject({
      grossCents: 180_506n,
      advancesCents: 180_506n,
      netCents: 0n,
    });
    const advances = await db.advance.findMany({
      where: { restaurantId: r.id },
      orderBy: { amountCents: 'desc' },
    });
    expect(advances.map((a) => [a.status, a.appliedCents])).toEqual([
      ['APPLIED', 1_000_000n],
      ['PENDING', 180_506n],
    ]);
    expect(await db.advanceApplication.count({ where: { advance: { restaurantId: r.id } } })).toBe(
      2,
    );

    // El saldo de Jean aparece en el reparto de la semana siguiente.
    const next = await start(r.owner, '2025-01-15');
    const nextView = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(nextView?.settlementId).toBe(next);
    expect(nextView?.people.find((p) => p.name === 'Jean')?.advanceCents).toBe('319494');
    expect(nextView?.advances).toMatchObject([{ employeeName: 'Jean', carried: true }]);
  });

  it('un reparto cerrado es inmutable (servicio y base)', async () => {
    const { r, ids, settlementId } = await libraryReady();
    await close(r.owner, settlementId);
    const closedMessage = 'Este reparto ya está cerrado: no se puede modificar.';
    expect(await tips(r.owner, settlementId, '1')).toEqual({ ok: false, error: closedMessage });
    expect(
      await hours(r.owner, settlementId, [{ employeeId: ids.Ivan as string, hours: '1' }]),
    ).toEqual({ ok: false, error: closedMessage });
    expect(await close(r.owner, settlementId)).toEqual({ ok: false, error: closedMessage });
    // Aun escribiendo directo en la base, los triggers lo impiden.
    await expect(
      db.periodHours.updateMany({ where: { settlementId }, data: { hours: 1 } }),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      db.weeklySettlement.update({ where: { id: settlementId }, data: { totalCents: 1n } }),
    ).rejects.toThrow(/IMMUTABLE/);
  });
});

describe('aislamiento y permisos', () => {
  it('otro restaurante no ve ni modifica este reparto', async () => {
    const { r, ids, settlementId } = await libraryReady();
    const other = await restaurant('Otro');
    const notFound = { ok: false, error: 'No se encontró ese reparto.' };
    expect(await tips(other.owner, settlementId, '1')).toEqual(notFound);
    expect(
      await hours(other.owner, settlementId, [{ employeeId: ids.Ivan as string, hours: '1' }]),
    ).toEqual(notFound);
    expect(await close(other.owner, settlementId)).toEqual(notFound);
    expect(await getOpenPeriodView(db, await as(other.owner, CAN.viewPeriods))).toBeNull();

    // Personas de otro restaurante no entran en este reparto.
    const otherIds = await staff(other, [['Intruso', 'Salón']]);
    expect(
      await hours(r.owner, settlementId, [{ employeeId: otherIds.Intruso as string, hours: '8' }]),
    ).toEqual({ ok: false, error: 'Esa persona no existe.' });

    await close(r.owner, settlementId);
    expect(await getClosedPeriodView(db, other.id, settlementId)).toBeNull();
    expect(await getClosedPeriodView(db, r.id, settlementId)).not.toBeNull();
  });

  it('Editor carga pero no cierra; Lector solo mira; sin membresía no entra', async () => {
    const { r, ids, settlementId } = await libraryReady();
    const editor = await member(r.id, 'EDITOR');
    const viewer = await member(r.id, 'VIEWER');

    expect(
      (await hours(editor, settlementId, [{ employeeId: ids.Jean as string, hours: '5' }])).ok,
    ).toBe(true);
    await expect(as(editor, CAN.closePeriod)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    const editorAccess = await as(editor, CAN.editPeriod);
    await expect(
      closePeriod(db, editorAccess, closePeriodInput.parse({ settlementId })),
    ).rejects.toBeInstanceOf(AccessDenied);
    expect((await getOpenPeriodView(db, editorAccess))?.canClose).toBe(false);

    await expect(as(viewer, CAN.editPeriod)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    const viewerView = await getOpenPeriodView(db, await as(viewer, CAN.viewPeriods));
    expect(viewerView).toMatchObject({ canEdit: false, canClose: false });

    const stranger: SessionUser = {
      id: (
        await db.user.create({ data: { email: `s-${randomUUID()}@example.invalid`, name: 'X' } })
      ).id,
      email: 'x',
      name: 'X',
    };
    await expect(as(stranger, CAN.viewPeriods)).rejects.toMatchObject({ reason: 'NOT_FOUND' });

    expect((await close(r.owner, settlementId)).ok).toBe(true);
  });
});
