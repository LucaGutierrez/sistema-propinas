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
 * Reparto por sectores de punta a punta contra PostgreSQL real (triggers incluidos):
 * configuración (validada al guardar) → reparto → cierre con snapshot → detalle e historial.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

type Puesto = 'Supervisor' | 'Barra' | 'Salón' | 'Bacha' | 'Cocina' | 'Runner';

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

type Sector = {
  name: string;
  base: 'TOTAL' | 'REMAINDER';
  percent: string;
  puestos: Puesto[];
};

/** Agrega el puesto Cocina y guarda todos los sectores de una vez. */
async function withKitchen(r: Restaurant, sectors: Sector[]) {
  const added = await config(r, { kind: 'addPosition', name: 'Cocina', factor: '0,02' });
  if (!added.ok) throw new Error(added.error);
  const positions = await positionsOf(r);
  const result = await config(r, {
    kind: 'sectors',
    sectors: sectors.map((s) => ({
      name: s.name,
      base: s.base,
      percent: s.percent,
      positionIds: s.puestos.map((p) => positions[p]),
    })),
  });
  return { positions, result };
}

/** El caso del pedido: Cocina 30 % del total; Salón (salón, barra, supervisor) 50 % del saldo. */
const PEDIDO: Sector[] = [
  { name: 'Cocina', base: 'TOTAL', percent: '30', puestos: ['Cocina'] },
  { name: 'Salón', base: 'REMAINDER', percent: '50', puestos: ['Salón', 'Barra', 'Supervisor'] },
  { name: 'Bacha', base: 'REMAINDER', percent: '100', puestos: ['Bacha'] },
];
const withBacha = (patch: Partial<Sector>) =>
  PEDIDO.map((s) => (s.name === 'Bacha' ? { ...s, ...patch } : s));

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
  it('no se activa sin sectores, y un sector que pide más de lo que queda no se guarda', async () => {
    const r = await restaurant();
    const direct = await config(r, { kind: 'value', key: 'groups', value: 'PORCENTAJE_POR_GRUPO' });
    expect(direct.ok).toBe(false);
    const { result } = await withKitchen(r, withBacha({ base: 'TOTAL', percent: '40' }));
    expect(result).toEqual({
      ok: false,
      error:
        'Bacha pide el 40 % del total, pero en ese paso solo queda el 35 % del total. Bajá su porcentaje o calculalo sobre el saldo.',
    });
    const view = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    // v1 estándar + v2 (Cocina): ninguna versión por sectores.
    expect(view?.current.number).toBe(2);
    expect(view?.current.values.groups).toBe('SIN_GRUPOS');
  });

  it('guarda los sectores, en orden y con sus puestos, en una versión nueva', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const view = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    expect(view?.current.number).toBe(3);
    expect(view?.current.values.groups).toBe('PORCENTAJE_POR_GRUPO');
    const sectors = view?.current.sectors ?? [];
    expect(sectors.map((s) => [s.name, s.base, s.percent])).toEqual([
      ['Cocina', 'TOTAL', '30'],
      ['Salón', 'REMAINDER', '50'],
      ['Bacha', 'REMAINDER', '100'],
    ]);
    const sectorName = new Map(sectors.map((s) => [s.id, s.name]));
    expect(
      Object.fromEntries(
        view?.current.positions.map((p) => [p.name, sectorName.get(p.sectorId ?? '')]) ?? [],
      ),
    ).toEqual({
      Supervisor: 'Salón',
      Barra: 'Salón',
      Salón: 'Salón',
      Bacha: 'Bacha',
      Cocina: 'Cocina',
    });
    // Otro cambio (una porción) crea otra versión que conserva los sectores.
    const positions = await positionsOf(r);
    const portion = await config(r, {
      kind: 'portion',
      positionId: positions.Barra,
      factor: '0,03',
    });
    if (!portion.ok) throw new Error(portion.error);
    const after = await loadDistributionConfig(db, await as(r.owner, CAN.viewDistributionConfig));
    expect(after?.current.number).toBe(4);
    expect(after?.current.sectors?.map((s) => [s.name, s.percent])).toEqual([
      ['Cocina', '30'],
      ['Salón', '50'],
      ['Bacha', '100'],
    ]);
    const barra = after?.current.positions.find((p) => p.name === 'Barra');
    expect(after?.current.sectors?.find((s) => s.id === barra?.sectorId)?.name).toBe('Salón');
    // La versión anterior (pozo único) queda intacta.
    expect(view?.versions.find((v) => v.number === 2)?.values.groups).toBe('SIN_GRUPOS');
  });

  it('la base no deja agregar ni cambiar sectores de una versión ya creada', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const version = await db.distributionPolicyVersion.findFirstOrThrow({
      where: { restaurantId: r.id, number: 3 },
    });
    await expect(
      db.policyVersionSector.create({
        data: { versionId: version.id, name: 'Extra', sortOrder: 4, base: 'TOTAL', percent: '1' },
      }),
    ).rejects.toThrow(/IMMUTABLE/);
    const sector = await db.policyVersionSector.findFirstOrThrow({
      where: { versionId: version.id },
    });
    await expect(
      db.policyVersionSector.update({ where: { id: sector.id }, data: { percent: '99' } }),
    ).rejects.toThrow(/IMMUTABLE/);
  });
});

describe('reparto por sectores', () => {
  it('$100.000: Cocina $30.000, quedan $70.000, Salón 50 % = $35.000; cierre e historial', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
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
    expect(open?.sectors?.sectors.map((s) => [s.name, s.percent, s.positionIds.length])).toEqual([
      ['Cocina', '30', 1],
      ['Salón', '50', 3],
      ['Bacha', '100', 1],
    ]);

    const closed = await close(r.owner, settlementId);
    if (!closed.ok) throw new Error(closed.error);
    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement.calcVersion).toBe('sectores-2+provisional-1');

    const detail = await getClosedPeriodView(db, r.id, settlementId);
    expect(
      Object.fromEntries(detail?.rows.map((row) => [row.name, row.amountCents]) ?? []),
    ).toEqual({
      Ana: '2000000', // 40 de 60 h de los $30.000 de Cocina
      Beto: '1000000',
      // Salón: $35.000 entre su gente con horas × porción (0,022; 0,022; 0,014).
      Caro: '1519737', // 45 × 0,022 = 0,99 de 2,28
      Dani: '1013158', // 30 × 0,022 = 0,66
      Eli: '967105', // 45 × 0,014 = 0,63
      Fede: '3500000', // Bacha: 100 % de lo que queda
    });
    const summary = detail?.sectorStages;
    expect(summary?.kind).toBe('steps');
    if (summary?.kind !== 'steps') return;
    expect(
      summary.steps.map((s) => [
        s.name,
        s.base,
        s.baseCents,
        s.percentE2,
        s.amountCents,
        s.leftAfterCents,
        s.positions,
        s.people,
      ]),
    ).toEqual([
      ['Cocina', 'TOTAL', '10000000', '3000', '3000000', '7000000', ['Cocina'], 2],
      [
        'Salón',
        'REMAINDER',
        '7000000',
        '5000',
        '3500000',
        '3500000',
        ['Supervisor', 'Barra', 'Salón'],
        3,
      ],
      ['Bacha', 'REMAINDER', '3500000', '10000', '3500000', '0', ['Bacha'], 1],
    ]);
    expect(summary.unassignedCents).toBe('0');
    // El historial muestra exactamente el mismo desglose (sale del mismo snapshot).
    const history = await getHistoryDetail(db, await as(r.owner, CAN.viewHistory), settlementId);
    expect(history?.sectorStages).toEqual(detail?.sectorStages);
  });

  it('un sector sin puestos cobra entero y los sobres son el resto', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(
      r,
      PEDIDO.map((s) => (s.name === 'Cocina' ? { ...s, puestos: [] } : s)),
    );
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Caro', 'Salón'],
      ['Fede', 'Bacha'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Caro as string]: '45',
      [ids.Fede as string]: '35',
    });
    const closed = await close(r.owner, settlementId);
    if (!closed.ok) throw new Error(closed.error);
    const payments = await db.weeklyPayment.findMany({ where: { settlementId } });
    expect(payments.reduce((sum, p) => sum + p.netCents, 0n)).toBe(7_000_000n);
    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    // Total entregado: $70.000 en sobres + $30.000 al sector Cocina.
    expect(settlement.totalFinalCents).toBe(10_000_000n);
    const detail = await getClosedPeriodView(db, r.id, settlementId);
    const summary = detail?.sectorStages;
    expect(summary?.kind === 'steps' && summary.steps[0]).toMatchObject({
      name: 'Cocina',
      amountCents: '3000000',
      positions: [],
      people: 0,
    });
  });

  it('Bacha 10 % del total: se guarda, muestra $25.000 sin asignar y no deja cerrar', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, withBacha({ base: 'TOTAL', percent: '10' }));
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Caro', 'Salón'],
      ['Fede', 'Bacha'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ana as string]: '40',
      [ids.Caro as string]: '45',
      [ids.Fede as string]: '35',
    });
    const closed = await close(r.owner, settlementId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error).toContain('Quedan $ 25.000,00 sin asignar');
    const settlement = await db.weeklySettlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement.closedAt).toBeNull();
  });

  it('un sector con puestos y sin nadie con horas no deja cerrar', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Caro', 'Salón'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ana as string]: '40',
      [ids.Caro as string]: '45',
    });
    const closed = await close(r.owner, settlementId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error).toContain('Nadie de Bacha tiene horas');
  });

  it('quien trabaja en un puesto que no está en ningún sector no deja cerrar', async () => {
    const r = await restaurant();
    const { result } = await withKitchen(r, PEDIDO);
    if (!result.ok) throw new Error(result.error);
    const added = await config(r, { kind: 'addPosition', name: 'Runner', factor: '0,01' });
    if (!added.ok) throw new Error(added.error);
    const ids = await staff(r, [
      ['Ana', 'Cocina'],
      ['Caro', 'Salón'],
      ['Fede', 'Bacha'],
      ['Ro', 'Runner'],
    ]);
    const settlementId = await openWith(r, '100.000', {
      [ids.Ana as string]: '40',
      [ids.Caro as string]: '45',
      [ids.Fede as string]: '35',
      [ids.Ro as string]: '20',
    });
    const closed = await close(r.owner, settlementId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error).toContain('su puesto (Runner) no está en ningún sector');
  });
});
