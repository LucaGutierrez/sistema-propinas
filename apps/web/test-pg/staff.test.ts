import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { authorize, type AccessContext } from '@/server/access/access';
import { CAN, roleAllowed, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import { bootstrapRestaurant, changePolicy } from '@/server/policy/service';
import { getStaffView } from '@/server/staff/repository';
import { addStaffInput, setStaffActiveInput, setStaffPositionInput } from '@/server/staff/schemas';
import { addEmployee, setEmployeeActive, setEmployeePosition } from '@/server/staff/service';

/*
 * "Personal" contra PostgreSQL real, con el mismo código que la página y las acciones:
 * `authorize` (lo que ejecuta requireAccess) → validación Zod → servicio / repositorio.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

async function newUser(name = 'Persona'): Promise<SessionUser> {
  const email = `u-${randomUUID()}@example.invalid`;
  const user = await db.user.create({ data: { email, name } });
  return { id: user.id, email, name };
}

/** Restaurante con política estándar (Supervisor, Barra, Salón, Bacha) y su OWNER. */
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
  ) as Record<'Supervisor' | 'Barra' | 'Salón' | 'Bacha', string>;
  return { id: input.restaurantId, owner, positions };
}

async function member(restaurantId: string, role: Exclude<Role, 'OWNER' | 'SELF'>) {
  const user = await newUser(role);
  await db.membership.create({ data: { userId: user.id, restaurantId, role } });
  return user;
}

/** Lo que hace la página: requireAccess(ver) + la vista del restaurante activo. */
async function openPage(user: SessionUser | null, preferredRestaurantId?: string) {
  const access = await authorize(db, user, { preferredRestaurantId, roles: CAN.viewStaff });
  const view = await getStaffView(db, {
    restaurantId: access.restaurantId,
    canEdit: roleAllowed(access.role, CAN.manageStaff),
  });
  return { access, view };
}

/** Lo que hace cada acción: requireAccess(gestionar) + Zod + servicio. */
async function manage(user: SessionUser | null): Promise<AccessContext> {
  return authorize(db, user, { roles: CAN.manageStaff });
}
const add = async (user: SessionUser | null, name: string, positionId: string) =>
  addEmployee(db, await manage(user), addStaffInput.parse({ name, positionId }));
const setPosition = async (user: SessionUser | null, employeeId: string, positionId: string) =>
  setEmployeePosition(
    db,
    await manage(user),
    setStaffPositionInput.parse({ employeeId, positionId }),
  );
const setActive = async (user: SessionUser | null, employeeId: string, active: boolean) =>
  setEmployeeActive(db, await manage(user), setStaffActiveInput.parse({ employeeId, active }));

async function added(user: SessionUser, name: string, positionId: string): Promise<string> {
  const result = await add(user, name, positionId);
  if (!result.ok) throw new Error(result.error);
  return result.value.employeeId;
}

const versions = (restaurantId: string) =>
  db.distributionPolicyVersion.count({ where: { restaurantId } });

describe('Personal: listado', () => {
  it('lista solo el personal del restaurante activo, con los puestos de la política vigente', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    await added(a.owner, 'Sofía', a.positions.Salón);
    await added(a.owner, 'Ivan', a.positions.Supervisor);
    await added(b.owner, 'Nadie de A', b.positions.Barra);

    const { view } = await openPage(a.owner);
    expect(view?.venueName).toBe('A');
    expect(view?.policyVersion).toBe(1);
    expect(view?.positions.map((p) => [p.name, p.factor])).toEqual([
      ['Supervisor', '0,014'],
      ['Barra', '0,022'],
      ['Salón', '0,022'],
      ['Bacha', '0,007'],
    ]);
    expect(view?.members.map((m) => [m.name, m.positionId, m.active])).toEqual([
      ['Sofía', a.positions.Salón, true],
      ['Ivan', a.positions.Supervisor, true],
    ]);
    expect(view?.canEdit).toBe(true);
  });

  it('un restaurante sin personal muestra la lista vacía (no se agregan datos de ejemplo)', async () => {
    const r = await restaurant('Vacío');
    const { view } = await openPage(r.owner);
    expect(view?.members).toEqual([]);
    expect(await db.employee.count({ where: { restaurantId: r.id } })).toBe(0);
  });

  it('muestra un empleado cargado con nombre y apellido por separado', async () => {
    const r = await restaurant();
    await db.employee.create({
      data: {
        restaurantId: r.id,
        firstName: 'Ana',
        lastName: 'Pérez',
        defaultPositionId: r.positions.Barra,
      },
    });
    expect((await openPage(r.owner)).view?.members.map((m) => m.name)).toEqual(['Ana Pérez']);
  });
});

describe('Personal: alta, puesto, baja y reactivación', () => {
  it('agregar crea la persona activa, con el puesto y en ESTE restaurante', async () => {
    const r = await restaurant();
    const id = await added(r.owner, '  Leo  ', r.positions.Salón);
    expect(await db.employee.findUniqueOrThrow({ where: { id } })).toMatchObject({
      restaurantId: r.id,
      firstName: 'Leo',
      lastName: '',
      defaultPositionId: r.positions.Salón,
      active: true,
    });
  });

  it('no permite dos personas activas con el mismo nombre (sin distinguir mayúsculas)', async () => {
    const r = await restaurant();
    await added(r.owner, 'Roro', r.positions.Barra);
    expect(await add(r.owner, 'RORO', r.positions.Salón)).toEqual({
      ok: false,
      error: 'Ya hay alguien activo llamado "RORO".',
    });
    expect(await db.employee.count({ where: { restaurantId: r.id } })).toBe(1);
  });

  it('cambiar el puesto no crea una versión de la política', async () => {
    const r = await restaurant();
    const id = await added(r.owner, 'Marcos', r.positions.Barra);
    expect(await setPosition(r.owner, id, r.positions.Bacha)).toMatchObject({ ok: true });
    expect((await db.employee.findUniqueOrThrow({ where: { id } })).defaultPositionId).toBe(
      r.positions.Bacha,
    );
    expect(await versions(r.id)).toBe(1);
  });

  it('cambiar la porción de un puesto no toca a las personas: siguen en el mismo puesto', async () => {
    const r = await restaurant();
    const id = await added(r.owner, 'Sofía', r.positions.Salón);
    const change = await changePolicy(
      db,
      { restaurantId: r.id, userId: r.owner.id },
      { kind: 'portion', positionId: r.positions.Salón, factor: '0,025' },
    );
    expect(change.ok).toBe(true);
    const employee = await db.employee.findUniqueOrThrow({ where: { id } });
    expect(employee.defaultPositionId).toBe(r.positions.Salón);
    const { view } = await openPage(r.owner);
    expect(view?.policyVersion).toBe(2);
    expect(view?.positions.find((p) => p.id === r.positions.Salón)?.factor).toBe('0,025');
  });

  it('dar de baja y reactivar', async () => {
    const r = await restaurant();
    const id = await added(r.owner, 'Nardelli', r.positions.Supervisor);
    expect(await setActive(r.owner, id, false)).toMatchObject({ ok: true });
    expect((await db.employee.findUniqueOrThrow({ where: { id } })).active).toBe(false);
    expect(await setPosition(r.owner, id, r.positions.Barra)).toEqual({
      ok: false,
      error: 'Reactivá a la persona antes de cambiar su puesto.',
    });
    // Mientras está de baja, otra persona puede usar el nombre; al reactivar se evita el duplicado.
    await added(r.owner, 'Nardelli', r.positions.Barra);
    expect(await setActive(r.owner, id, true)).toEqual({
      ok: false,
      error: 'Ya hay alguien activo llamado "Nardelli".',
    });
    const other = await restaurant();
    const alone = await added(other.owner, 'Solo', other.positions.Barra);
    await setActive(other.owner, alone, false);
    expect(await setActive(other.owner, alone, true)).toMatchObject({ ok: true });
  });
});

describe('Personal: posiciones e ids del cliente', () => {
  it('el puesto tiene que ser de la política vigente de este restaurante', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    expect(await add(a.owner, 'Intruso', b.positions.Salón)).toEqual({
      ok: false,
      error: 'Elegí un puesto.',
    });
    expect(await add(a.owner, 'Inventado', randomUUID())).toEqual({
      ok: false,
      error: 'Elegí un puesto.',
    });
    const id = await added(a.owner, 'Sofía', a.positions.Salón);
    expect(await setPosition(a.owner, id, b.positions.Barra)).toEqual({
      ok: false,
      error: 'Ese puesto no existe.',
    });
    expect(await db.employee.count({ where: { restaurantId: a.id } })).toBe(1);
    expect((await db.employee.findUniqueOrThrow({ where: { id } })).defaultPositionId).toBe(
      a.positions.Salón,
    );
  });

  it('un puesto que no está en la política vigente no se puede asignar', async () => {
    const r = await restaurant();
    const orphan = await db.position.create({ data: { restaurantId: r.id, name: 'Sin versión' } });
    expect(await add(r.owner, 'Alguien', orphan.id)).toEqual({
      ok: false,
      error: 'Elegí un puesto.',
    });
  });

  it('una persona de otro restaurante "no existe", aunque se conozca su id', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    const fromB = await added(b.owner, 'De B', b.positions.Barra);
    expect(await setPosition(a.owner, fromB, a.positions.Salón)).toEqual({
      ok: false,
      error: 'Esa persona no existe.',
    });
    expect(await setActive(a.owner, fromB, false)).toEqual({
      ok: false,
      error: 'Esa persona no existe.',
    });
    expect(await db.employee.findUniqueOrThrow({ where: { id: fromB } })).toMatchObject({
      defaultPositionId: b.positions.Barra,
      active: true,
    });
  });
});

describe('Personal: permisos', () => {
  it.each([
    ['MANAGER', true, true],
    ['EDITOR', true, false],
    ['VIEWER', true, false],
  ] as const)('%s: ver=%s, gestionar=%s', async (role, canView, canManage) => {
    const r = await restaurant();
    const user = await member(r.id, role);
    const { view } = await openPage(user);
    expect(canView).toBe(true);
    expect(view?.canEdit).toBe(canManage);
    if (canManage) {
      expect((await add(user, 'Nueva', r.positions.Barra)).ok).toBe(true);
    } else {
      await expect(add(user, 'Nueva', r.positions.Barra)).rejects.toMatchObject({
        reason: 'FORBIDDEN',
      });
      const id = await added(r.owner, 'Existente', r.positions.Barra);
      await expect(setPosition(user, id, r.positions.Salón)).rejects.toMatchObject({
        reason: 'FORBIDDEN',
      });
      await expect(setActive(user, id, false)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
      expect(await db.employee.findUniqueOrThrow({ where: { id } })).toMatchObject({
        defaultPositionId: r.positions.Barra,
        active: true,
      });
    }
  });

  it('OWNER ve y gestiona', async () => {
    const r = await restaurant();
    expect((await openPage(r.owner)).view?.canEdit).toBe(true);
    expect((await add(r.owner, 'Del dueño', r.positions.Bacha)).ok).toBe(true);
  });

  it('SELF no ve la pantalla (solo sus sobres)', async () => {
    const r = await restaurant();
    const employeeId = await added(r.owner, 'Propio', r.positions.Barra);
    const self = await newUser('Propio');
    await db.membership.create({
      data: { userId: self.id, restaurantId: r.id, role: 'SELF', employeeId },
    });
    await expect(openPage(self)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    await expect(add(self, 'X', r.positions.Barra)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
  });

  it('sin sesión o sin membresía no hay acceso (ni lectura ni escritura)', async () => {
    const r = await restaurant();
    const stranger = await newUser();
    await expect(openPage(null)).rejects.toMatchObject({ reason: 'UNAUTHENTICATED' });
    await expect(add(null, 'X', r.positions.Barra)).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
    // Aunque la cookie de restaurante activo apunte a uno ajeno.
    await expect(openPage(stranger, r.id)).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    await expect(add(stranger, 'X', r.positions.Barra)).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
    expect(await db.employee.count({ where: { restaurantId: r.id } })).toBe(0);
  });

  it('el dueño de A con la cookie apuntando a B opera sobre A (su restaurante)', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    const { access, view } = await openPage(a.owner, b.id);
    expect(access.restaurantId).toBe(a.id);
    expect(view?.venueName).toBe('A');
  });
});
