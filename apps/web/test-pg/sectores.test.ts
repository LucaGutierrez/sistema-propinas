import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { authorize } from '@/server/access/access';
import { CAN, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import { getHistoryDetail } from '@/server/history/repository';
import { getClosedPeriodView, getOpenPeriodView } from '@/server/periods/repository';
import {
  closePeriodInput,
  setHoursInput,
  setTipsInput,
  startPeriodInput,
} from '@/server/periods/schemas';
import { closePeriod, setPeriodHours, setPeriodTips, startPeriod } from '@/server/periods/service';
import { changeDistributionConfig, loadDistributionConfig } from '@/server/policy/commands';
import { bootstrapRestaurant, type PolicyChangeRequest } from '@/server/policy/service';
import { addEmployee } from '@/server/staff/service';

/*
 * Reparto por sectores, en etapas, de punta a punta contra PostgreSQL real (triggers incluidos):
 * configuración (validada al guardar) → reparto → cierre con snapshot → detalle e historial.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

type Puesto = 'Supervisor' | 'Barra' | 'Salón' | 'Bacha' | 'Cocina';

async function restaurant() {
  const input = {
    restaurantId: randomUUID(),
    restaurantName: 'Local',
    operatorEmail: `owner-${randomUUID()}@example.invalid`,
    operatorName: 'Dueño',
  };
  const result = await bootstrapRestaurant(db, input);
  if (!result.ok) throw new Error(result.error);
  const owner: SessionUser = { id: result.value.userId, email: input.operatorEmail, name: 'Dueño' };
  return { id: input.restaurantId, owner };
}
type Restaurant = Awaited<ReturnType<typeof restaurant>>;

const as = (user: SessionUser, roles: readonly Role[]) => authorize(db, user, { roles });

const config = async (r: Restaurant, request: PolicyChangeRequest) =>
  changeDistributionConfig(db, await as(r.owner, CAN.editDistributionConfig), request);

async function positionsOf(r: Restaurant): Promise<Record<Puesto, string>> {
  const rows = await db.position.findMany({ where: { restaurantId: r.id } });
  return Object.fromEntries(rows.map((p) => [p.name, p.id])) as Record<Puesto, string>;
}

/** Agrega el puesto Cocina y guarda las etapas de todos los puestos de una vez. */
async function withKitchen(r: Restaurant, stages: Partial<Record<Puesto, [number, string]>>) {
  const added = await config(r, { kind: 'addPosition', name: 'Cocina', factor: '0,02' });
  if (!added.ok) throw new Error(added.error);
  const positions = await positionsOf(r);
  const result = await config(r, {
    kind: 'stages',
    stages: (Object.keys(positions) as Puesto[]).map((name) => ({
      positionId: positions[name],
      stage: stages[name]?.[0] ?? null,
      percent: stages[name]?.[1] ?? '',
    })),
  });
  return { positions, result };
}

/** El caso del pedido: Cocina 30 % del total; Salón, Barra y Supervisor sobre el saldo; Bacha. */
const PEDIDO: Partial<Record<Puesto, [number, string]>> = {
  Cocina: [1, '30'],
  Salón: [2, '50'],
  Barra: [2, '25'],
  Supervisor: [2, '15'],
  Bacha: [3, '100'],
};

async function staff(r: Restaurant, people: [string, Puesto][]) {
  const positions = await positionsOf(r);
  const access = await as(r.owner, CAN.manageStaff);
  const ids: Record<string, string> = {};
  for (const [name, puesto] of people) {
    const result = await addEmployee(db, access, { name, positionId: positions[puesto] });
    if (!result.ok) throw new Error(result.error);
    ids[name] = result.value.employeeId;
  }
  return ids;
}

/** Abre la semana del 2025-01-06 con la propina total y las horas (por nombre). */
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

describe('configuración por sectores', () => {
  it('no se activa sin etapas completas, y una configuración que no cierra no se guarda', async () => {
    const r = await restaurant();
    const direct = await config(r, { kind: 'value', key: 'groups', value: 'PORCENTAJE_POR_GRUPO' });
    expect(direct.ok).toBe(false);
    const { result } = await withKitchen(r, { ...PEDIDO, Salón: [2, '70'] });
    expect(result).toEqual({
      ok: false,
      error:
        'La etapa 2 suma 110 % del saldo y después viene la etapa 3: tiene que sumar menos de 100 % para que quede saldo.',
    });
    const view = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    // v1 estándar + v2 (Cocina): ninguna versión por sectores.
    expect(view?.current.number).toBe(2);
    expect(view?.current.values.groups).toBe('SIN_GRUPOS');
  });

  it('guarda etapa y porcentaje de cada puesto en una versión nueva', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const view = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    expect(view?.current.number).toBe(3);
    expect(view?.current.values.groups).toBe('PORCENTAJE_POR_GRUPO');
    expect(
      Object.fromEntries(
        view?.current.positions.map((p) => [p.name, [p.stage, p.stagePercent]]) ?? [],
      ),
    ).toEqual({
      Supervisor: [2, '15'],
      Barra: [2, '25'],
      Salón: [2, '50'],
      Bacha: [3, '100'],
      Cocina: [1, '30'],
    });
    // La versión anterior (pozo único) queda intacta.
    expect(view?.versions.find((v) => v.number === 2)?.values.groups).toBe('SIN_GRUPOS');
  });
});

describe('reparto por sectores', () => {
  it('cocina sobre el total, los demás sobre el saldo; cierre, snapshot e historial', async () => {
    const r = await restaurant();
    const { positions, result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Beto', 'Cocina'],
      ['Caro', 'Salón'],
      ['Dani', 'Barra'],
      ['Eli', 'Supervisor'],
      ['Fede', 'Bacha'],
    ]);
    const hours = { Ana: '40', Beto: '20', Caro: '45', Dani: '30', Eli: '45', Fede: '35' };
    const settlementId = await openWith(
      r,
      '100.000',
      Object.fromEntries(Object.entries(hours).map(([name, h]) => [ids[name] as string, h])),
    );
    const open = await getOpenPeriodView(db, await as(r.owner, CAN.viewPeriods));
    expect(open?.sectors?.find((s) => s.name === 'Cocina')).toMatchObject({
      stage: 1,
      percent: '30',
    });

    const closed = await close(r.owner, settlementId);
    if (!closed.ok) throw new Error(closed.error);
    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement.calcVersion).toBe('sectores-1+provisional-1');

    const detail = await getClosedPeriodView(db, r.id, settlementId);
    expect(
      Object.fromEntries(detail?.rows.map((row) => [row.name, row.amountCents]) ?? []),
    ).toEqual({
      Ana: '2000000', // 40 de 60 h de los $30.000 de Cocina
      Beto: '1000000',
      Caro: '3500000', // 50 % de $70.000, no de $100.000
      Dani: '1750000',
      Eli: '1050000',
      Fede: '700000',
    });
    // La participación queda sobre el total: Ana cobra el 20 %.
    expect(detail?.rows.find((row) => row.name === 'Ana')?.percentE2).toBe('2000');
    expect(
      detail?.sectorStages?.map((s) => [
        s.number,
        s.base,
        s.baseCents,
        s.amountCents,
        s.remainderCents,
      ]),
    ).toEqual([
      [1, 'TOTAL', '10000000', '3000000', '7000000'],
      [2, 'REMAINDER', '7000000', '6300000', '700000'],
      [3, 'REMAINDER', '700000', '700000', '0'],
    ]);
    const history = await getHistoryDetail(db, await as(r.owner, CAN.viewHistory), settlementId);
    expect(history?.sectorStages).toEqual(detail?.sectorStages);
    expect(history?.sectorStages?.[0]?.sectors).toEqual([
      {
        id: positions.Cocina,
        name: 'Cocina',
        percentE2: '3000',
        amountCents: '3000000',
        people: 2,
      },
    ]);
  });

  it('caso pedido: $100.000 → cocina $30.000, salón $63.000 (90 % de $70.000), bacha $7.000', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, {
      Cocina: [1, '30'],
      Salón: [2, '60'],
      Barra: [2, '20'],
      Supervisor: [2, '10'],
      Bacha: [3, '100'],
    });
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Caro', 'Salón'],
      ['Dani', 'Barra'],
      ['Eli', 'Supervisor'],
      ['Fede', 'Bacha'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ana as string]: '40',
      [ids.Caro as string]: '45',
      [ids.Dani as string]: '30',
      [ids.Eli as string]: '45',
      [ids.Fede as string]: '35',
    });
    const closed = await close(r.owner, settlementId);
    if (!closed.ok) throw new Error(closed.error);
    const detail = await getClosedPeriodView(db, r.id, settlementId);
    expect(
      detail?.sectorStages?.map((s) => [s.number, s.baseCents, s.percentE2, s.amountCents]),
    ).toEqual([
      [1, '10000000', '3000', '3000000'], // Cocina: 30 % de $100.000
      [2, '7000000', '9000', '6300000'], // Salón: 90 % de $70.000
      [3, '700000', '10000', '700000'], // Bacha: 100 % de $7.000
    ]);
    expect(
      Object.fromEntries(detail?.rows.map((row) => [row.name, row.amountCents]) ?? []),
    ).toEqual({
      Ana: '3000000',
      Caro: '4200000',
      Dani: '1400000',
      Eli: '700000',
      Fede: '700000',
    });
  });

  it('bacha con menos de 100 % se guarda, muestra lo sin asignar y no deja cerrar', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, { ...PEDIDO, Bacha: [3, '50'] });
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Caro', 'Salón'],
      ['Dani', 'Barra'],
      ['Eli', 'Supervisor'],
      ['Fede', 'Bacha'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ana as string]: '40',
      [ids.Caro as string]: '45',
      [ids.Dani as string]: '30',
      [ids.Eli as string]: '45',
      [ids.Fede as string]: '35',
    });
    const closed = await close(r.owner, settlementId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error).toContain('Quedan $ 3.500,00 sin asignar');
    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement.closedAt).toBeNull();
  });

  it('un sector con monto y sin nadie con horas no deja cerrar', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Caro', 'Salón'],
      ['Dani', 'Barra'],
      ['Eli', 'Supervisor'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ana as string]: '40',
      [ids.Caro as string]: '45',
      [ids.Dani as string]: '30',
      [ids.Eli as string]: '45',
    });
    const closed = await close(r.owner, settlementId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error).toContain('Nadie de Bacha tiene horas');
  });

  it('un puesto nuevo sin etapa deja la configuración incompleta y no se puede cerrar', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [['Caro', 'Salón']]);
    const settlementId = await openWith(r, '100.000', { [ids.Caro as string]: '45' });
    const added = await config(r, { kind: 'addPosition', name: 'Runner', factor: '0,01' });
    if (!added.ok) throw new Error(added.error);
    const closed = await close(r.owner, settlementId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) {
      expect(closed.error).toContain('La configuración por sectores está incompleta');
      expect(closed.error).toContain('Runner: elegí en qué etapa cobra.');
    }
  });
});
