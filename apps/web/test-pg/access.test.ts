import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  AccessDenied,
  assertEmployeeInScope,
  authorize,
  employeeScope,
  listUserRestaurants,
  pickActiveRestaurant,
  type AccessContext,
} from '@/server/access/access';
import { CAN, ROLES, type Role } from '@/server/access/roles';
import type { SessionUser } from '@/server/auth/session';
import { changeDistributionConfig, loadDistributionConfig } from '@/server/policy/commands';
import { bootstrapRestaurant, type PolicyChangeRequest } from '@/server/policy/service';
import { createRestaurant } from '@/server/restaurants/service';

/*
 * Autorización real (sesión → membresía → rol) contra PostgreSQL. `authorize` es exactamente lo
 * que ejecuta `requireAccess` en cada página y acción (esta lee la sesión y la cookie del pedido
 * y se las pasa). La sesión se representa con el usuario que devuelve Better Auth; la sesión de
 * punta a punta está en auth.test.ts.
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

/** Restaurante con política estándar y su OWNER (vía db:bootstrap). */
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
  return { id: input.restaurantId, owner };
}

async function employee(restaurantId: string, firstName: string): Promise<string> {
  const e = await db.employee.create({ data: { restaurantId, firstName, lastName: 'X' } });
  return e.id;
}

/** Usuario nuevo con `role` en el restaurante (SELF vinculado a un empleado propio). */
async function member(restaurantId: string, role: Exclude<Role, 'OWNER'>) {
  const user = await newUser(role);
  const employeeId = role === 'SELF' ? await employee(restaurantId, `Emp ${role}`) : null;
  await db.membership.create({ data: { userId: user.id, restaurantId, role, employeeId } });
  return { user, employeeId };
}

/** Lo que hace la página de Configuración: requireAccess(ver) + leer la configuración. */
async function openConfigPage(user: SessionUser | null, preferredRestaurantId?: string) {
  const access = await authorize(db, user, {
    preferredRestaurantId,
    roles: CAN.viewDistributionConfig,
  });
  return { access, view: await loadDistributionConfig(db, access) };
}

/** Lo que hace cada acción de Configuración: requireAccess(configurar) + cambiar la política. */
async function configAction(
  user: SessionUser | null,
  request: PolicyChangeRequest,
  preferredRestaurantId?: string,
) {
  const access = await authorize(db, user, {
    preferredRestaurantId,
    roles: CAN.editDistributionConfig,
  });
  return changeDistributionConfig(db, access, request);
}

const PORTION: PolicyChangeRequest = { kind: 'value', key: 'rounding', value: 'PESO' };

const versions = (restaurantId: string) =>
  db.distributionPolicyVersion.count({ where: { restaurantId } });

describe('requireAccess (authorize)', () => {
  it('sin sesión: UNAUTHENTICATED, en la página y en la acción', async () => {
    const r = await restaurant();
    await expect(authorize(db, null, { restaurantId: r.id, roles: ROLES })).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
    await expect(openConfigPage(null, r.id)).rejects.toMatchObject({ reason: 'UNAUTHENTICATED' });
    await expect(configAction(null, PORTION, r.id)).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
    expect(await versions(r.id)).toBe(1);
  });

  it('autenticado sin membresía: NOT_FOUND (404, no revela que el restaurante existe)', async () => {
    const r = await restaurant();
    const stranger = await newUser();
    for (const restaurantId of [r.id, randomUUID(), 'no-es-un-uuid']) {
      await expect(authorize(db, stranger, { restaurantId, roles: ROLES })).rejects.toMatchObject({
        reason: 'NOT_FOUND',
      });
    }
    // Sin restaurante indicado: no tiene ninguno (aunque la cookie apunte a uno ajeno).
    await expect(openConfigPage(stranger, r.id)).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    await expect(configAction(stranger, PORTION, r.id)).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
    expect(await listUserRestaurants(db, stranger.id)).toEqual([]);
    expect(await versions(r.id)).toBe(1);
  });

  it('devuelve un contexto tipado con el rol y el empleado vinculado', async () => {
    const r = await restaurant('Contexto');
    const self = await member(r.id, 'SELF');
    const access = await authorize(db, self.user, { restaurantId: r.id, roles: ROLES });
    expect(access).toEqual({
      restaurantId: r.id,
      restaurantName: 'Contexto',
      userId: self.user.id,
      userName: 'SELF',
      userEmail: self.user.email,
      role: 'SELF',
      membershipId: expect.any(String),
      employeeId: self.employeeId,
    } satisfies AccessContext);
  });

  it('un restaurante archivado no es accesible ni para su dueño', async () => {
    const r = await restaurant();
    await db.restaurant.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
    await expect(
      authorize(db, r.owner, { restaurantId: r.id, roles: ROLES }),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    expect(await listUserRestaurants(db, r.owner.id)).toEqual([]);
  });
});

describe('roles en Configuración de distribución', () => {
  it.each([
    ['OWNER', true, true],
    ['MANAGER', true, true],
    ['EDITOR', true, false],
    ['VIEWER', true, false],
    ['SELF', false, false],
  ] as const)('%s: ver=%s, cambiar=%s', async (role, canView, canEdit) => {
    const r = await restaurant();
    const user = role === 'OWNER' ? r.owner : (await member(r.id, role)).user;

    if (canView) {
      const { access, view } = await openConfigPage(user);
      expect(access.role).toBe(role);
      expect(view?.current.number).toBe(1);
      expect(view?.canEdit).toBe(canEdit);
    } else {
      await expect(openConfigPage(user)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    }

    if (canEdit) {
      expect(await configAction(user, PORTION)).toMatchObject({ ok: true, value: { number: 2 } });
      const version = await db.distributionPolicyVersion.findFirstOrThrow({
        where: { restaurantId: r.id, number: 2 },
      });
      expect(version.createdById).toBe(user.id);
    } else {
      await expect(configAction(user, PORTION)).rejects.toMatchObject({ reason: 'FORBIDDEN' });
      expect(await versions(r.id)).toBe(1);
    }
  });

  it('la acción del servidor sin permiso no escribe nada aunque la llamen directo', async () => {
    const r = await restaurant();
    const viewer = await member(r.id, 'VIEWER');
    const salon = await db.position.findFirstOrThrow({
      where: { restaurantId: r.id, name: 'Salón' },
    });
    const requests: PolicyChangeRequest[] = [
      PORTION,
      { kind: 'portion', positionId: salon.id, factor: '0,03' },
      { kind: 'addPosition', name: 'Cocina', factor: '0,01' },
    ];
    for (const request of requests) {
      await expect(configAction(viewer.user, request)).rejects.toBeInstanceOf(AccessDenied);
    }
    expect(await versions(r.id)).toBe(1);
    expect(await db.position.count({ where: { restaurantId: r.id } })).toBe(4);
  });

  it('defensa en profundidad: el comando rechaza un contexto con rol insuficiente', async () => {
    const r = await restaurant();
    const viewer = await member(r.id, 'VIEWER');
    const access = await authorize(db, viewer.user, { roles: CAN.viewDistributionConfig });
    await expect(changeDistributionConfig(db, access, PORTION)).rejects.toMatchObject({
      reason: 'FORBIDDEN',
    });
    const self = await member(r.id, 'SELF');
    const selfAccess = await authorize(db, self.user, { roles: ROLES });
    await expect(loadDistributionConfig(db, selfAccess)).rejects.toMatchObject({
      reason: 'FORBIDDEN',
    });
    expect(await versions(r.id)).toBe(1);
  });
});

describe('otro restaurante y scoping', () => {
  it('el dueño de A no ve ni cambia B, aunque conozca su id', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    for (const roles of [CAN.viewDistributionConfig, CAN.editDistributionConfig]) {
      await expect(authorize(db, a.owner, { restaurantId: b.id, roles })).rejects.toMatchObject({
        reason: 'NOT_FOUND',
      });
    }
    // Una cookie con el id de B no sirve: opera sobre A (su único restaurante).
    const { access } = await openConfigPage(a.owner, b.id);
    expect(access.restaurantId).toBe(a.id);
    expect(await configAction(a.owner, PORTION, b.id)).toMatchObject({ ok: true });
    expect(await versions(a.id)).toBe(2);
    expect(await versions(b.id)).toBe(1);
  });

  it('un puesto de B no se puede cambiar desde A (el servicio filtra por restaurante)', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    const salonB = await db.position.findFirstOrThrow({
      where: { restaurantId: b.id, name: 'Salón' },
    });
    expect(
      await configAction(a.owner, { kind: 'portion', positionId: salonB.id, factor: '0,03' }),
    ).toEqual({ ok: false, error: 'Ese puesto no existe.' });
    expect(await versions(a.id)).toBe(1);
    expect(await versions(b.id)).toBe(1);
  });

  it('un usuario en varios restaurantes tiene un rol distinto en cada uno', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    await db.membership.create({
      data: { userId: a.owner.id, restaurantId: b.id, role: 'VIEWER' },
    });

    expect((await listUserRestaurants(db, a.owner.id)).map((r) => [r.name, r.role])).toEqual([
      ['A', 'OWNER'],
      ['B', 'VIEWER'],
    ]);
    expect((await configAction(a.owner, PORTION, a.id)).ok).toBe(true);
    // Con B como restaurante activo, su rol ahí (VIEWER) no alcanza para cambiar.
    await expect(configAction(a.owner, PORTION, b.id)).rejects.toMatchObject({
      reason: 'FORBIDDEN',
    });
    expect((await openConfigPage(a.owner, b.id)).access).toMatchObject({
      restaurantId: b.id,
      role: 'VIEWER',
    });
    expect(await versions(b.id)).toBe(1);
  });

  it('el restaurante activo elegido (cookie) solo vale si el usuario es miembro', async () => {
    const a = await restaurant('A');
    const b = await restaurant('B');
    await db.membership.create({
      data: { userId: a.owner.id, restaurantId: b.id, role: 'VIEWER' },
    });
    const other = await restaurant('Ajeno');

    expect(await pickActiveRestaurant(db, a.owner.id, b.id)).toBe(b.id);
    expect(await pickActiveRestaurant(db, a.owner.id, undefined)).toBe(a.id);
    // Un id ajeno (o inventado) en la cookie no da acceso: vuelve al primero propio.
    expect(await pickActiveRestaurant(db, a.owner.id, other.id)).toBe(a.id);
    expect(await pickActiveRestaurant(db, a.owner.id, 'basura')).toBe(a.id);
    expect(await pickActiveRestaurant(db, (await newUser()).id, other.id)).toBeNull();
  });
});

describe('SELF: solo su empleado', () => {
  it('ve únicamente a su empleado vinculado; otro empleado (o de otro restaurante) es 404', async () => {
    const r = await restaurant();
    const self = await member(r.id, 'SELF');
    const colleague = await employee(r.id, 'Colega');
    const other = await restaurant('Otro');
    const outsider = await employee(other.id, 'Ajeno');
    const access = await authorize(db, self.user, { roles: CAN.viewEmployees });

    const visible = await db.employee.findMany({
      where: employeeScope(access),
      select: { id: true },
    });
    expect(visible.map((e) => e.id)).toEqual([self.employeeId]);

    expect(() =>
      assertEmployeeInScope(access, { id: self.employeeId ?? '', restaurantId: r.id }),
    ).not.toThrow();
    expect(() => assertEmployeeInScope(access, { id: colleague, restaurantId: r.id })).toThrow(
      AccessDenied,
    );
    expect(() => assertEmployeeInScope(access, { id: outsider, restaurantId: other.id })).toThrow(
      AccessDenied,
    );
  });

  it('los demás roles ven a todo el personal del restaurante, nunca al de otro', async () => {
    const r = await restaurant();
    const viewer = await member(r.id, 'VIEWER');
    const e1 = await employee(r.id, 'Uno');
    const e2 = await employee(r.id, 'Dos');
    const other = await restaurant('Otro');
    const outsider = await employee(other.id, 'Ajeno');
    const access = await authorize(db, viewer.user, { roles: CAN.viewEmployees });

    const visible = await db.employee.findMany({
      where: employeeScope(access),
      select: { id: true },
    });
    expect(visible.map((e) => e.id).sort()).toEqual([e1, e2].sort());
    expect(() => assertEmployeeInScope(access, { id: outsider, restaurantId: other.id })).toThrow(
      AccessDenied,
    );
  });
});

describe('alta de restaurante', () => {
  it('crear un restaurante crea la membresía OWNER de quien lo crea y la política v1', async () => {
    const user = await newUser('Fundador');
    const result = await createRestaurant(db, user, '  Nuevo local  ');
    if (!result.ok) throw new Error(result.error);
    const { restaurantId, versionId } = result.value;

    expect(await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).toMatchObject({
      name: 'Nuevo local',
      currentPolicyVersionId: versionId,
    });
    expect(
      await db.membership.findMany({
        where: { restaurantId },
        select: { userId: true, role: true },
      }),
    ).toEqual([{ userId: user.id, role: 'OWNER' }]);
    const access = await authorize(db, user, { restaurantId, roles: ['OWNER'] });
    expect(access.role).toBe('OWNER');
  });

  it('sin sesión no se crea nada', async () => {
    const before = await db.restaurant.count();
    await expect(createRestaurant(db, null, 'Nadie')).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
    expect(await db.restaurant.count()).toBe(before);
  });

  it('el OWNER es único: la base rechaza un segundo dueño', async () => {
    const r = await restaurant();
    const intruder = await newUser();
    await expect(
      db.membership.create({ data: { userId: intruder.id, restaurantId: r.id, role: 'OWNER' } }),
    ).rejects.toThrow(/ux_memberships_one_owner|Unique constraint/);
  });

  it('db:bootstrap no agrega un segundo dueño y no deja nada a medias', async () => {
    const r = await restaurant('Con dueño');
    const email = `otro-${randomUUID()}@example.invalid`;
    const result = await bootstrapRestaurant(db, {
      restaurantId: r.id,
      restaurantName: 'Con dueño',
      operatorEmail: email,
      operatorName: 'Otro',
    });
    expect(result).toEqual({
      ok: false,
      error: 'El restaurante ya tiene otro dueño: revisar a mano.',
    });
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(await db.membership.count({ where: { restaurantId: r.id } })).toBe(1);
  });
});
