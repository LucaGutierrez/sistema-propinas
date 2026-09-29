import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AccessDenied, authorize, type AccessContext } from '@/server/access/access';
import { CAN, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import { getEnvelopesView } from '@/server/envelopes/repository';
import { getHistoryDetail } from '@/server/history/repository';
import { getClosedPeriodView, getOpenPeriodView } from '@/server/periods/repository';
import {
  closePeriodInput,
  setHoursInput,
  setTipsInput,
  startPeriodInput,
} from '@/server/periods/schemas';
import {
  CALC_VERSION,
  CALC_VERSION_WITH_POINTS,
  closePeriod,
  setPeriodHours,
  setPeriodTips,
  startPeriod,
} from '@/server/periods/service';
import {
  changeDistributionConfig,
  changePortionDisplay,
  loadDistributionConfig,
} from '@/server/policy/commands';
import { bootstrapRestaurant } from '@/server/policy/service';
import { getStaffView } from '@/server/staff/repository';
import { setStaffPointsInput } from '@/server/staff/schemas';
import { addEmployee, setEmployeeActive, setEmployeePoints } from '@/server/staff/service';

/*
 * M1 — métodos de participación, puntos individuales y formato de la porción, de punta a punta
 * contra PostgreSQL real (triggers incluidos) con el mismo código que las páginas y las acciones:
 * `authorize` (lo que ejecuta requireAccess) → Zod → servicio / repositorio.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

type Puesto = 'Supervisor' | 'Barra' | 'Salón' | 'Bacha';
type Method = 'POR_PUESTO' | 'POR_PUNTOS' | 'PUESTO_POR_PUNTOS';

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
type Restaurant = Awaited<ReturnType<typeof restaurant>>;

async function member(restaurantId: string, role: Exclude<Role, 'OWNER' | 'SELF'>) {
  const email = `u-${randomUUID()}@example.invalid`;
  const user = await db.user.create({ data: { email, name: role } });
  await db.membership.create({ data: { userId: user.id, restaurantId, role } });
  return { id: user.id, email, name: role } satisfies SessionUser;
}

const as = (user: SessionUser, roles: readonly Role[], restaurantId?: string) =>
  authorize(db, user, { roles, ...(restaurantId ? { restaurantId } : {}) });

async function staff(r: Restaurant, people: [string, Puesto][]) {
  const access = await as(r.owner, CAN.manageStaff);
  const ids: Record<string, string> = {};
  for (const [name, puesto] of people) {
    const result = await addEmployee(db, access, { name, positionId: r.positions[puesto] });
    if (!result.ok) throw new Error(result.error);
    ids[name] = result.value.employeeId;
  }
  return ids;
}

async function setPoints(user: SessionUser, employeeId: string, points: string) {
  return setEmployeePoints(
    db,
    await as(user, CAN.manageStaff),
    setStaffPointsInput.parse({ employeeId, points }),
  );
}

async function setMethod(r: Restaurant, value: Method) {
  const result = await changeDistributionConfig(db, await as(r.owner, CAN.editDistributionConfig), {
    kind: 'value',
    key: 'weights',
    value,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Abre la semana del 2025-01-06, carga la propina y las horas, y devuelve el período. */
async function openWith(r: Restaurant, total: string, hours: Record<string, string>) {
  const started = await startPeriod(
    db,
    await as(r.owner, CAN.editPeriod),
    startPeriodInput.parse({ date: '2025-01-08' }),
  );
  if (!started.ok) throw new Error(started.error);
  const settlementId = started.value.settlementId;
  const edit = await as(r.owner, CAN.editPeriod);
  const tips = await setPeriodTips(
    db,
    edit,
    setTipsInput.parse({ mode: 'total', settlementId, total }),
  );
  if (!tips.ok) throw new Error(tips.error);
  const saved = await setPeriodHours(
    db,
    edit,
    setHoursInput.parse({
      settlementId,
      entries: Object.entries(hours).map(([employeeId, h]) => ({ employeeId, hours: h })),
    }),
  );
  if (!saved.ok) throw new Error(saved.error);
  return settlementId;
}

const close = async (user: SessionUser, settlementId: string) =>
  closePeriod(db, await as(user, CAN.closePeriod), closePeriodInput.parse({ settlementId }));

async function closeOrThrow(r: Restaurant, settlementId: string) {
  const result = await close(r.owner, settlementId);
  if (!result.ok) throw new Error(result.error);
}

async function items(settlementId: string) {
  const rows = await db.dailyDistributionItem.findMany({
    where: { dailyDistribution: { settlementId } },
    orderBy: { employeeNameSnapshot: 'asc' },
    select: {
      employeeNameSnapshot: true,
      portionSnapshot: true,
      individualPointsSnapshot: true,
      hours: true,
      points: true,
      percentage: true,
      amountCents: true,
      finalCents: true,
    },
  });
  return rows.map((i) => ({
    name: i.employeeNameSnapshot,
    portion: i.portionSnapshot?.toFixed(3) ?? null,
    points: i.individualPointsSnapshot?.toFixed(2) ?? null,
    hours: i.hours.toFixed(2),
    weight: i.points.toFixed(8),
    percentage: i.percentage.toFixed(6),
    amount: i.amountCents.toString(),
    final: i.finalCents.toString(),
  }));
}

/** Todo lo que se ve de un reparto cerrado: pantalla del reparto, historial y sobres. */
async function snapshotViews(r: Restaurant, settlementId: string) {
  const view = await as(r.owner, CAN.viewHistory);
  const history = await getHistoryDetail(db, view, settlementId);
  const closed = await getClosedPeriodView(db, r.id, settlementId);
  const envelopes = await getEnvelopesView(db, await as(r.owner, CAN.viewEnvelopes), settlementId);
  return {
    items: await items(settlementId),
    // La preferencia de formato es presentación actual: se compara aparte.
    history: history ? { ...history, portionDisplay: undefined } : null,
    closed: closed ? { ...closed, portionDisplay: undefined } : null,
    envelopes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('M1: restaurantes y personal existentes', () => {
  it('un restaurante queda con BY_POSITION, porción decimal y 1,00 punto por persona', async () => {
    const r = await restaurant();
    const ids = await staff(r, [['Ana', 'Salón']]);
    const config = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    expect(config?.current.values.weights).toBe('POR_PUESTO');
    expect(config?.portionDisplay).toBe('DECIMAL');
    const version = await db.distributionPolicyVersion.findFirstOrThrow({
      where: { restaurantId: r.id },
    });
    expect(version.portionMode).toBe('BY_POSITION');
    const employee = await db.employee.findUniqueOrThrow({ where: { id: ids.Ana as string } });
    expect(employee.individualPoints.toFixed(2)).toBe('1.00');
    const staffView = await getStaffView(db, { restaurantId: r.id, canEdit: true });
    expect(staffView?.members).toMatchObject([{ name: 'Ana', individualPoints: '1,00' }]);
    expect(staffView?.method).toBe('BY_POSITION');
  });
});

describe('M1: BY_POSITION reproduce exactamente el cálculo anterior', () => {
  it('con puntos distintos de 1, BY_POSITION los ignora: mismos importes y snapshot sin puntos', async () => {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Ivan', 'Supervisor'],
      ['Leo', 'Salón'],
      ['Jean', 'Bacha'],
    ]);
    // Puntos cargados, pero el método vigente es "por puesto": no intervienen.
    expect((await setPoints(r.owner, ids.Ivan as string, '3')).ok).toBe(true);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ivan as string]: '45',
      [ids.Leo as string]: '54',
      [ids.Jean as string]: '4',
    });
    await closeOrThrow(r, settlementId);
    // 45 × 0,014 = 0,63 · 54 × 0,022 = 1,188 · 4 × 0,007 = 0,028 → Σ 1,846 (horas × porción).
    expect(await items(settlementId)).toEqual([
      {
        name: 'Ivan',
        portion: '0.014',
        points: null,
        hours: '45.00',
        weight: '0.63000000',
        percentage: '0.341278',
        amount: '3412785',
        final: '3412785',
      },
      {
        name: 'Jean',
        portion: '0.007',
        points: null,
        hours: '4.00',
        weight: '0.02800000',
        percentage: '0.015168',
        amount: '151679',
        final: '151679',
      },
      {
        name: 'Leo',
        portion: '0.022',
        points: null,
        hours: '54.00',
        weight: '1.18800000',
        percentage: '0.643554',
        amount: '6435536',
        final: '6435536',
      },
    ]);
    const settlement = await db.weeklySettlement.findUniqueOrThrow({
      where: { id: settlementId },
    });
    expect(settlement.calcVersion).toBe(CALC_VERSION);
    expect(settlement.policySnapshot).toMatchObject({
      portionMode: 'BY_POSITION',
      portionDisplay: 'DECIMAL',
    });
  });
});

describe('M1: BY_POINTS', () => {
  it('horas × puntos: la porción del puesto no interviene y queda NULL en el snapshot', async () => {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Juan', 'Salón'],
      ['Pedro', 'Barra'],
      ['Ana', 'Bacha'],
    ]);
    expect((await setPoints(r.owner, ids.Juan as string, '1,20')).ok).toBe(true);
    const settlementId = await openWith(r, '100.000', {
      [ids.Juan as string]: '40',
      [ids.Pedro as string]: '40',
      [ids.Ana as string]: '40',
    });
    // Cambiar el método con el período abierto: versión nueva y el período pasa a ella.
    const changed = await setMethod(r, 'POR_PUNTOS');
    expect(changed.movedPeriods).toEqual([settlementId]);
    const open = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(open?.method).toBe('BY_POINTS');

    await closeOrThrow(r, settlementId);
    // 40 × 1,20 = 48 · 40 × 1 = 40 · 40 × 1 = 40 → Σ 128: Bacha y Barra pesan igual.
    expect(await items(settlementId)).toEqual([
      {
        name: 'Ana',
        portion: null,
        points: '1.00',
        hours: '40.00',
        weight: '40.00000000',
        percentage: '0.312500',
        amount: '3125000',
        final: '3125000',
      },
      {
        name: 'Juan',
        portion: null,
        points: '1.20',
        hours: '40.00',
        weight: '48.00000000',
        percentage: '0.375000',
        amount: '3750000',
        final: '3750000',
      },
      {
        name: 'Pedro',
        portion: null,
        points: '1.00',
        hours: '40.00',
        weight: '40.00000000',
        percentage: '0.312500',
        amount: '3125000',
        final: '3125000',
      },
    ]);
    const settlement = await db.weeklySettlement.findUniqueOrThrow({
      where: { id: settlementId },
    });
    expect(settlement.calcVersion).toBe(CALC_VERSION_WITH_POINTS);
    expect(settlement.policySnapshot).toMatchObject({ portionMode: 'BY_POINTS' });

    const history = await getHistoryDetail(db, await as(r.owner, CAN.viewHistory), settlementId);
    expect(history?.method).toBe('BY_POINTS');
    expect(history?.people.find((p) => p.name === 'Juan')).toMatchObject({
      factor: null,
      individualPoints: '1,20',
      weightE8: '4800000000',
      percentE2: '3750',
      grossCents: '3750000',
    });
  });
});

describe('M1: BY_POSITION_TIMES_POINTS', () => {
  it('mismo puesto y horas: con más puntos cobra más (horas × porción × puntos)', async () => {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Juan', 'Salón'],
      ['Pedro', 'Salón'],
    ]);
    expect((await setPoints(r.owner, ids.Juan as string, '1.2')).ok).toBe(true);
    await setMethod(r, 'PUESTO_POR_PUNTOS');
    const settlementId = await openWith(r, '100.000', {
      [ids.Juan as string]: '40',
      [ids.Pedro as string]: '40',
    });
    await closeOrThrow(r, settlementId);
    // 40 × 0,022 × 1,20 = 1,056 · 40 × 0,022 × 1 = 0,88 → $ 54.545,45 y $ 45.454,55.
    expect(await items(settlementId)).toEqual([
      {
        name: 'Juan',
        portion: '0.022',
        points: '1.20',
        hours: '40.00',
        weight: '1.05600000',
        percentage: '0.545455',
        amount: '5454545',
        final: '5454545',
      },
      {
        name: 'Pedro',
        portion: '0.022',
        points: '1.00',
        hours: '40.00',
        weight: '0.88000000',
        percentage: '0.454545',
        amount: '4545455',
        final: '4545455',
      },
    ]);
    const closed = await getClosedPeriodView(db, r.id, settlementId);
    expect(closed?.method).toBe('BY_POSITION_TIMES_POINTS');
    expect(closed?.rows.map((row) => [row.name, row.factor, row.individualPoints])).toEqual([
      ['Juan', '0,022', '1,20'],
      ['Pedro', '0,022', '1,00'],
    ]);
  });
});

describe('M1: formato de la porción (decimal / porcentaje)', () => {
  it('cambiarlo no crea versión, no cambia importes ni porciones y queda en la bitácora', async () => {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Ana', 'Salón'],
      ['Beto', 'Bacha'],
    ]);
    const settlementId = await openWith(r, '50.000', {
      [ids.Ana as string]: '30',
      [ids.Beto as string]: '10',
    });
    const view = await as(r.owner, CAN.viewPeriods);
    const before = await getOpenPeriodView(db, view);
    expect(before?.settlementId).toBe(settlementId);
    const versionsBefore = await db.distributionPolicyVersion.count({
      where: { restaurantId: r.id },
    });

    const changed = await changePortionDisplay(
      db,
      await as(r.owner, CAN.editDistributionConfig),
      'PERCENT',
    );
    expect(changed).toEqual({ ok: true, value: { portionDisplay: 'PERCENT', changed: true } });

    const after = await getOpenPeriodView(db, view);
    expect(after?.portionDisplay).toBe('PERCENT');
    expect({ ...after, portionDisplay: 'DECIMAL' }).toEqual(before);
    expect(await db.distributionPolicyVersion.count({ where: { restaurantId: r.id } })).toBe(
      versionsBefore,
    );
    const config = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    expect(config?.portionDisplay).toBe('PERCENT');
    expect(config?.current.positions.map((p) => p.factor)).toEqual([
      '0,014',
      '0,022',
      '0,022',
      '0,007',
    ]);
    expect(
      await db.auditLog.findMany({
        where: { restaurantId: r.id, action: 'restaurant.portion_display_changed' },
        select: { payload: true },
      }),
    ).toEqual([{ payload: { from: 'DECIMAL', to: 'PERCENT' } }]);
    // Volver a elegir el mismo: nada cambia.
    expect(
      await changePortionDisplay(db, await as(r.owner, CAN.editDistributionConfig), 'PERCENT'),
    ).toEqual({ ok: true, value: { portionDisplay: 'PERCENT', changed: false } });
  });
});

describe('M1: puntos individuales inválidos', () => {
  it.each(['0', '0,00', '-1', 'abc', '', '1,234', '10000'])('Zod rechaza "%s"', (points) => {
    expect(setStaffPointsInput.safeParse({ employeeId: randomUUID(), points }).success).toBe(false);
  });

  it.each([
    ['1,2', '1.20'],
    ['0.8', '0.80'],
    ['1', '1.00'],
    ['9.999,99', null],
    ['9999,99', '9999.99'],
  ])('Zod normaliza "%s" → %s', (points, expected) => {
    const parsed = setStaffPointsInput.safeParse({ employeeId: randomUUID(), points });
    expect(parsed.success ? parsed.data.points : null).toBe(expected);
  });

  it('la base rechaza puntos <= 0 aunque se salteen las validaciones', async () => {
    const r = await restaurant();
    const ids = await staff(r, [['Ana', 'Salón']]);
    await expect(
      db.employee.update({ where: { id: ids.Ana as string }, data: { individualPoints: 0 } }),
    ).rejects.toThrow(/ck_employees_individual_points/);
  });

  it('una persona de baja no cambia sus puntos; el cambio queda en la bitácora', async () => {
    const r = await restaurant();
    const ids = await staff(r, [['Ana', 'Salón']]);
    expect(await setPoints(r.owner, ids.Ana as string, '1,5')).toEqual({
      ok: true,
      value: { employeeId: ids.Ana, points: '1.50' },
    });
    expect(
      await db.auditLog.findMany({
        where: { restaurantId: r.id, action: 'employee.points_changed' },
        select: { entityId: true, payload: true },
      }),
    ).toEqual([{ entityId: ids.Ana, payload: { from: '1.00', to: '1.50' } }]);
    await setEmployeeActive(db, await as(r.owner, CAN.manageStaff), {
      employeeId: ids.Ana as string,
      active: false,
    });
    expect(await setPoints(r.owner, ids.Ana as string, '2')).toEqual({
      ok: false,
      error: 'Reactivá a la persona antes de cambiar sus puntos.',
    });
  });
});

describe('M1: un reparto cerrado nunca cambia', () => {
  async function closedWithPoints() {
    const r = await restaurant();
    const ids = await staff(r, [
      ['Juan', 'Salón'],
      ['Pedro', 'Barra'],
    ]);
    await setPoints(r.owner, ids.Juan as string, '1,20');
    await setMethod(r, 'PUESTO_POR_PUNTOS');
    const settlementId = await openWith(r, '100.000', {
      [ids.Juan as string]: '40',
      [ids.Pedro as string]: '40',
    });
    await closeOrThrow(r, settlementId);
    return { r, ids, settlementId };
  }

  it('cambiar los puntos después del cierre no modifica ítems, historial, reparto ni sobres', async () => {
    const { r, ids, settlementId } = await closedWithPoints();
    const before = await snapshotViews(r, settlementId);
    expect((await setPoints(r.owner, ids.Juan as string, '3')).ok).toBe(true);
    expect((await setPoints(r.owner, ids.Pedro as string, '0,5')).ok).toBe(true);
    expect(await snapshotViews(r, settlementId)).toEqual(before);
    expect(before.items.map((i) => [i.name, i.points])).toEqual([
      ['Juan', '1.20'],
      ['Pedro', '1.00'],
    ]);
  });

  it('cambiar la porción, el método o el formato después del cierre no lo modifica', async () => {
    const { r, settlementId } = await closedWithPoints();
    const before = await snapshotViews(r, settlementId);
    const portion = await changeDistributionConfig(
      db,
      await as(r.owner, CAN.editDistributionConfig),
      { kind: 'portion', positionId: r.positions.Salón, factor: '0,05' },
    );
    expect(portion.ok).toBe(true);
    await setMethod(r, 'POR_PUNTOS');
    await changePortionDisplay(db, await as(r.owner, CAN.editDistributionConfig), 'PERCENT');
    expect(await snapshotViews(r, settlementId)).toEqual(before);
    // El historial sigue diciendo con qué método y versión se calculó.
    expect(before.history).toMatchObject({
      method: 'BY_POSITION_TIMES_POINTS',
      calcVersion: CALC_VERSION_WITH_POINTS,
      policyNumber: 2,
    });
  });

  it('los sobres usan los importes guardados (sin recalcular)', async () => {
    const { r, settlementId } = await closedWithPoints();
    const envelopes = await getEnvelopesView(
      db,
      await as(r.owner, CAN.viewEnvelopes),
      settlementId,
    );
    const payments = await db.weeklyPayment.findMany({
      where: { settlementId },
      orderBy: { employeeNameSnapshot: 'asc' },
      select: { employeeNameSnapshot: true, netCents: true },
    });
    expect(payments.map((p) => [p.employeeNameSnapshot, p.netCents.toString()])).toEqual([
      ['Juan', '5454545'],
      ['Pedro', '4545455'],
    ]);
    expect(JSON.stringify(envelopes)).toContain('5454545');
  });
});

describe('M1: aislamiento y permisos', () => {
  it('no se pueden cambiar los puntos de una persona de otro restaurante', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    const idsB = await staff(b, [['Ana', 'Salón']]);
    expect(await setPoints(a.owner, idsB.Ana as string, '2')).toEqual({
      ok: false,
      error: 'Esa persona no existe.',
    });
    const anaB = await db.employee.findUniqueOrThrow({ where: { id: idsB.Ana as string } });
    expect(anaB.individualPoints.toFixed(2)).toBe('1.00');
  });

  it('el formato de la porción es de cada restaurante', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    await changePortionDisplay(db, await as(a.owner, CAN.editDistributionConfig), 'PERCENT');
    const rows = await db.restaurant.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, portionDisplay: true },
    });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.portionDisplay]))).toEqual({
      [a.id]: 'PERCENT',
      [b.id]: 'DECIMAL',
    });
  });

  it.each(['EDITOR', 'VIEWER'] as const)(
    '%s no puede cambiar puntos ni el formato de la porción',
    async (role) => {
      const r = await restaurant();
      const ids = await staff(r, [['Ana', 'Salón']]);
      const user = await member(r.id, role);
      await expect(as(user, CAN.manageStaff, r.id)).rejects.toMatchObject({
        reason: 'FORBIDDEN',
      });
      await expect(as(user, CAN.editDistributionConfig, r.id)).rejects.toMatchObject({
        reason: 'FORBIDDEN',
      });
      // Aunque el servicio se llame directo con su contexto (solo puede ver), se rechaza.
      const context: AccessContext = await as(user, CAN.viewStaff, r.id);
      await expect(
        setEmployeePoints(db, context, { employeeId: ids.Ana as string, points: '2.00' }),
      ).rejects.toBeInstanceOf(AccessDenied);
      await expect(changePortionDisplay(db, context, 'PERCENT')).rejects.toBeInstanceOf(
        AccessDenied,
      );
      const ana = await db.employee.findUniqueOrThrow({ where: { id: ids.Ana as string } });
      expect(ana.individualPoints.toFixed(2)).toBe('1.00');
    },
  );

  it('el Encargado sí puede cambiar puntos y formato', async () => {
    const r = await restaurant();
    const ids = await staff(r, [['Ana', 'Salón']]);
    const manager = await member(r.id, 'MANAGER');
    expect((await setPoints(manager, ids.Ana as string, '0,75')).ok).toBe(true);
    expect(
      (await changePortionDisplay(db, await as(manager, CAN.editDistributionConfig), 'PERCENT')).ok,
    ).toBe(true);
  });
});

describe('M1: concurrencia entre el cierre y un cambio de puntos', () => {
  it('el cierre congela un valor coherente: el ponderado guardado es horas × los puntos guardados', async () => {
    for (let run = 0; run < 5; run += 1) {
      const r = await restaurant();
      const ids = await staff(r, [
        ['Juan', 'Salón'],
        ['Pedro', 'Salón'],
      ]);
      await setMethod(r, 'POR_PUNTOS');
      const settlementId = await openWith(r, '100.000', {
        [ids.Juan as string]: '40',
        [ids.Pedro as string]: '40',
      });
      const [closed, changed] = await Promise.all([
        close(r.owner, settlementId),
        setPoints(r.owner, ids.Juan as string, '2'),
      ]);
      expect(closed.ok).toBe(true);
      expect(changed.ok).toBe(true);
      const rows = await db.dailyDistributionItem.findMany({
        where: { dailyDistribution: { settlementId } },
        select: { hours: true, individualPointsSnapshot: true, points: true, amountCents: true },
      });
      for (const row of rows) {
        expect(['1.00', '2.00']).toContain(row.individualPointsSnapshot?.toFixed(2));
        expect(row.hours.mul(row.individualPointsSnapshot ?? 0).equals(row.points)).toBe(true);
      }
      const total = rows.reduce((sum, row) => sum + row.amountCents, 0n);
      expect(total).toBe(10_000_000n);
      // El empleado quedó con los puntos nuevos para los próximos repartos.
      const juan = await db.employee.findUniqueOrThrow({ where: { id: ids.Juan as string } });
      expect(juan.individualPoints.toFixed(2)).toBe('2.00');
    }
  });
});
