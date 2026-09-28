import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { STANDARD_TEMPLATE } from '@/lib/policy/standard';
import { authorize, listUserRestaurants, pickActiveRestaurant } from '@/server/access/access';
import { CAN, ROLES } from '@/server/access/roles';
import { createAuth, SIGN_UP_PER_HOUR, type Auth } from '@/server/auth/auth';
import { sessionUserFrom, type SessionUser } from '@/server/auth/session';
import { getCurrentPolicy } from '@/server/policy/repository';
import { bootstrapRestaurant, changePolicy } from '@/server/policy/service';
import { createRestaurant, MAX_OWNED_RESTAURANTS } from '@/server/restaurants/service';
import { getRestaurantSummary } from '@/server/restaurants/summary';
import { getStaffView } from '@/server/staff/repository';
import { addEmployee } from '@/server/staff/service';

/*
 * Registro público y alta del primer restaurante, de punta a punta sobre PostgreSQL real:
 * Better Auth (HTTP, como /registro y /login) → sesión → createRestaurant (como
 * /crear-restaurante) → acceso real (`authorize`, lo que ejecuta requireAccess).
 */

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'contraseña-de-prueba-1';

let db: PrismaClient;
let auth: Auth;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
  auth = createAuth(db, {
    secret: `test-secret-${randomUUID()}-${randomUUID()}`,
    baseURL: BASE_URL,
  });
});
afterAll(async () => {
  await db.$disconnect();
});

/** Cada pedido viene de una IP distinta salvo que se indique (los límites son por IP). */
let nextIp = 1;
const ip = () => `198.18.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE_URL,
        'x-forwarded-for': ip(),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

const signUp = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  post('/sign-up/email', body, headers);
const signIn = (email: string, password: string) => post('/sign-in/email', { email, password });

function sessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith('gutip.session_token='));
  if (!cookie) throw new Error('no llegó la cookie de sesión');
  return cookie.split(';')[0] ?? '';
}

const newEmail = () => `alta-${randomUUID()}@example.invalid`;

/** Registro + login, como /registro: devuelve el usuario de la sesión real. */
async function registered(name = 'Nueva Persona') {
  const email = newEmail();
  expect((await signUp({ name, email, password: PASSWORD })).status).toBe(200);
  const login = await signIn(email, PASSWORD);
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  const user = await sessionUserFrom(auth, new Headers({ cookie }));
  if (!user) throw new Error('sin sesión');
  return { user, email, cookie };
}

async function newRestaurant(user: SessionUser, name: string) {
  const result = await createRestaurant(db, user, name);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('registro', () => {
  it('registro exitoso: crea solo la cuenta (email normalizado, nombre recortado)', async () => {
    const email = newEmail();
    const response = await signUp({
      name: '  Ana  ',
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ email, name: 'Ana', emailVerified: false });
    expect(await db.account.count({ where: { userId: user.id, providerId: 'credential' } })).toBe(
      1,
    );
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await signIn(email, PASSWORD)).status).toBe(200);
  });

  it('email duplicado: misma respuesta que un registro nuevo, sin crear ni cambiar nada', async () => {
    const email = newEmail();
    const first = await signUp({ name: 'Original', email, password: PASSWORD });
    const second = await signUp({
      name: 'Otro',
      email: email.toUpperCase(),
      password: 'otra-clave-123',
    });
    expect(second.status).toBe(first.status);
    const [a, b] = [await first.json(), await second.json()];
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    expect(b.token).toBeNull();
    expect(Object.keys(b.user).sort()).toEqual(Object.keys(a.user).sort());
    // No hay mensaje de "ya existe": la respuesta no dice si el email estaba registrado.
    expect(JSON.stringify(b)).not.toMatch(/exist/i);

    expect(await db.user.count({ where: { email } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { email } })).name).toBe('Original');
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    expect((await signIn(email, 'otra-clave-123')).status).toBe(401);
  });

  it.each([
    ['contraseña corta', { password: 'corta' }],
    ['contraseña demasiado larga', { password: 'x'.repeat(129) }],
    ['email inválido', { email: 'no-es-un-email' }],
    ['nombre vacío', { name: '   ' }],
    ['un rol pedido por el cliente', { role: 'OWNER' }],
    ['un restaurante pedido por el cliente', { restaurantId: randomUUID() }],
  ])('rechaza %s sin crear la cuenta', async (_, override) => {
    const body = { name: 'Alguien', email: newEmail(), password: PASSWORD, ...override };
    const response = await signUp(body);
    expect(response.status).toBe(400);
    expect(await db.user.count({ where: { email: String(body.email).toLowerCase() } })).toBe(0);
  });

  it('un error de validación es igual exista o no el email (no revela cuentas)', async () => {
    const existing = newEmail();
    await signUp({ name: 'Existe', email: existing, password: PASSWORD });
    const forExisting = await signUp({ name: '', email: existing, password: PASSWORD });
    const forNew = await signUp({ name: '', email: newEmail(), password: PASSWORD });
    expect(forExisting.status).toBe(forNew.status);
    expect(await forExisting.json()).toEqual(await forNew.json());
  });

  it(`limita los registros por IP (${SIGN_UP_PER_HOUR} por hora)`, async () => {
    const sameIp = { 'x-forwarded-for': '198.51.100.99' };
    const statuses: number[] = [];
    for (let i = 0; i < SIGN_UP_PER_HOUR + 1; i++) {
      statuses.push(
        (await signUp({ name: 'Bot', email: newEmail(), password: PASSWORD }, sameIp)).status,
      );
    }
    expect(statuses.slice(0, SIGN_UP_PER_HOUR).every((s) => s === 200)).toBe(true);
    expect(statuses[SIGN_UP_PER_HOUR]).toBe(429);
    // Otra IP sigue pudiendo registrarse.
    expect((await signUp({ name: 'Persona', email: newEmail(), password: PASSWORD })).status).toBe(
      200,
    );
  });
});

describe('usuario nuevo y su primer restaurante', () => {
  it('recién registrado no tiene restaurantes ni acceso a ninguno', async () => {
    const { user } = await registered();
    expect(await listUserRestaurants(db, user.id)).toEqual([]);
    expect(await pickActiveRestaurant(db, user.id, undefined)).toBeNull();
    await expect(authorize(db, user, { roles: ROLES })).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
  });

  it('no ve un restaurante existente (como RESTORANTE DEMO), ni aunque la cookie apunte a él', async () => {
    const demo = await bootstrapRestaurant(db, {
      restaurantId: randomUUID(),
      restaurantName: 'RESTORANTE DEMO',
      operatorEmail: `demo-${randomUUID()}@example.invalid`,
      operatorName: 'Dueño demo',
    });
    if (!demo.ok) throw new Error(demo.error);
    const demoId = demo.value.restaurantId;
    const { user } = await registered();
    expect(await pickActiveRestaurant(db, user.id, demoId)).toBeNull();
    await expect(authorize(db, user, { restaurantId: demoId, roles: ROLES })).rejects.toMatchObject(
      { reason: 'NOT_FOUND' },
    );

    const mine = await newRestaurant(user, 'Restaurante Test');
    expect((await listUserRestaurants(db, user.id)).map((r) => r.name)).toEqual([
      'Restaurante Test',
    ]);
    expect(await pickActiveRestaurant(db, user.id, demoId)).toBe(mine.restaurantId);
    expect(await db.membership.count({ where: { restaurantId: demoId } })).toBe(1);
  });

  it('crear el restaurante: OWNER, política estándar v1 vigente y todo lo demás vacío', async () => {
    const { user } = await registered('Fundadora');
    const { restaurantId, versionId } = await newRestaurant(user, '  Restaurante Test  ');

    expect(await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).toMatchObject({
      name: 'Restaurante Test',
      currentPolicyVersionId: versionId,
    });
    expect(
      await db.membership.findMany({
        where: { restaurantId },
        select: { userId: true, role: true, employeeId: true },
      }),
    ).toEqual([{ userId: user.id, role: 'OWNER', employeeId: null }]);

    const policy = await getCurrentPolicy(db, restaurantId);
    expect(policy).toMatchObject({
      id: versionId,
      number: 1,
      origin: 'STANDARD',
      templateCode: STANDARD_TEMPLATE.code,
      templateVersion: STANDARD_TEMPLATE.version,
      createdById: user.id,
    });
    expect(policy?.positions.map((p) => [p.name, p.portion])).toEqual([
      ['Supervisor', '0.0140000000'],
      ['Barra', '0.0220000000'],
      ['Salón', '0.0220000000'],
      ['Bacha', '0.0070000000'],
    ]);

    expect(await getRestaurantSummary(db, restaurantId)).toEqual({
      name: 'Restaurante Test',
      policyVersion: 1,
      activeEmployees: 0,
      distributions: 0,
      periods: 0,
      advances: 0,
      payments: 0,
    });
    expect(await db.auditLog.count({ where: { restaurantId } })).toBe(0);
  });

  it('si la política falla, no queda ni el restaurante ni la membresía (rollback total)', async () => {
    const { user } = await registered();
    const restaurantsBefore = await db.restaurant.count();
    const broken = { ...STANDARD_TEMPLATE, positions: [{ name: 'Rota', factor: '0' }] };
    await expect(createRestaurant(db, user, 'No debe quedar', broken)).rejects.toThrow(
      /Porción inválida/,
    );
    expect(await db.restaurant.count()).toBe(restaurantsBefore);
    expect(await db.restaurant.count({ where: { name: 'No debe quedar' } })).toBe(0);
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.position.count({ where: { name: 'Rota' } })).toBe(0);
    // El usuario sigue existiendo (se registró antes) y puede reintentar.
    expect((await newRestaurant(user, 'Ahora sí')).versionId).toBeTruthy();
  });

  it('sin sesión no se crea un restaurante', async () => {
    const before = await db.restaurant.count();
    await expect(createRestaurant(db, null, 'Nadie')).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
    expect(await db.restaurant.count()).toBe(before);
  });

  it('crear un segundo restaurante no cambia el primero', async () => {
    const { user } = await registered();
    const first = await newRestaurant(user, 'Primero');
    const change = await changePolicy(
      db,
      { restaurantId: first.restaurantId, userId: user.id },
      {
        kind: 'portion',
        positionId: (await getCurrentPolicy(db, first.restaurantId))!.positions[2]!.positionId,
        factor: '0,025',
      },
    );
    expect(change.ok).toBe(true);
    const second = await newRestaurant(user, 'Segundo');

    const firstPolicy = await getCurrentPolicy(db, first.restaurantId);
    expect(firstPolicy?.number).toBe(2);
    expect(firstPolicy?.positions.find((p) => p.name === 'Salón')?.portion).toBe('0.0250000000');
    const secondPolicy = await getCurrentPolicy(db, second.restaurantId);
    expect(secondPolicy?.number).toBe(1);
    expect(secondPolicy?.positions.find((p) => p.name === 'Salón')?.portion).toBe('0.0220000000');
    expect((await listUserRestaurants(db, user.id)).map((r) => [r.name, r.role])).toEqual([
      ['Primero', 'OWNER'],
      ['Segundo', 'OWNER'],
    ]);
  });

  it(`una cuenta puede crear hasta ${MAX_OWNED_RESTAURANTS} restaurantes`, async () => {
    const { user } = await registered();
    for (let i = 0; i < MAX_OWNED_RESTAURANTS; i++) await newRestaurant(user, `Local ${i}`);
    expect(await createRestaurant(db, user, 'Uno más')).toEqual({
      ok: false,
      error: `Llegaste al máximo de ${MAX_OWNED_RESTAURANTS} restaurantes por cuenta.`,
    });
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(MAX_OWNED_RESTAURANTS);
  });
});

describe('aislamiento, sesión y permisos del OWNER', () => {
  it('dos cuentas nuevas: cada una ve solo su restaurante', async () => {
    const a = await registered('A');
    const b = await registered('B');
    const ra = await newRestaurant(a.user, 'Local A');
    const rb = await newRestaurant(b.user, 'Local B');

    expect((await authorize(db, a.user, { roles: ROLES })).restaurantId).toBe(ra.restaurantId);
    expect((await authorize(db, b.user, { roles: ROLES })).restaurantId).toBe(rb.restaurantId);
    await expect(
      authorize(db, a.user, { restaurantId: rb.restaurantId, roles: ROLES }),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    await expect(
      authorize(db, b.user, { restaurantId: ra.restaurantId, roles: ROLES }),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    // La cookie de restaurante activo apuntando al ajeno no sirve.
    expect(await pickActiveRestaurant(db, a.user.id, rb.restaurantId)).toBe(ra.restaurantId);
  });

  it('login posterior, sesión y logout del usuario nuevo', async () => {
    const { user, email, cookie } = await registered('Con sesión');
    await newRestaurant(user, 'Mi local');
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);

    const again = await signIn(email, PASSWORD);
    expect(again.status).toBe(200);
    expect((await sessionUserFrom(auth, new Headers({ cookie: sessionCookie(again) })))?.id).toBe(
      user.id,
    );

    expect((await post('/sign-out', {}, { cookie })).status).toBe(200);
    expect(await sessionUserFrom(auth, new Headers({ cookie }))).toBeNull();
  });

  it('el OWNER del restaurante nuevo puede configurarlo y gestionar el personal', async () => {
    const { user } = await registered('Dueña');
    const { restaurantId } = await newRestaurant(user, 'Con permisos');
    const config = await authorize(db, user, { roles: CAN.editDistributionConfig });
    expect(config).toMatchObject({ restaurantId, role: 'OWNER' });
    const staff = await authorize(db, user, { roles: CAN.manageStaff });
    const salon = (await getCurrentPolicy(db, restaurantId))!.positions.find(
      (p) => p.name === 'Salón',
    )!;
    expect(
      (await addEmployee(db, staff, { name: 'Primera persona', positionId: salon.positionId })).ok,
    ).toBe(true);
    expect((await getRestaurantSummary(db, restaurantId))?.activeEmployees).toBe(1);
  });
});

describe('aislamiento entre restaurantes reales (cuentas nuevas)', () => {
  /** Lo que ve la pantalla del restaurante activo: requireAccess + lecturas por restaurante. */
  async function screens(user: SessionUser, preferredRestaurantId?: string) {
    const access = await authorize(db, user, { preferredRestaurantId, roles: CAN.viewStaff });
    return {
      access,
      summary: await getRestaurantSummary(db, access.restaurantId),
      staff: await getStaffView(db, { restaurantId: access.restaurantId, canEdit: true }),
    };
  }

  it('cada cuenta ve solo su restaurante, su personal y sus números', async () => {
    const a = await registered('Dueña A');
    const b = await registered('Dueño B');
    const ra = await newRestaurant(a.user, 'Restaurante A');
    const rb = await newRestaurant(b.user, 'Restaurante B');
    const accessA = await authorize(db, a.user, { roles: CAN.manageStaff });
    const salonA = (await getCurrentPolicy(db, ra.restaurantId))!.positions[2]!.positionId;
    expect((await addEmployee(db, accessA, { name: 'Solo de A', positionId: salonA })).ok).toBe(
      true,
    );

    const seenByA = await screens(a.user);
    expect(seenByA.summary).toMatchObject({ name: 'Restaurante A', activeEmployees: 1 });
    expect(seenByA.staff?.members.map((m) => m.name)).toEqual(['Solo de A']);

    const seenByB = await screens(b.user);
    expect(seenByB.summary).toMatchObject({ name: 'Restaurante B', activeEmployees: 0 });
    expect(seenByB.staff?.members).toEqual([]);
    // B no llega a A ni pidiéndolo explícitamente ni con la cookie de restaurante activo.
    await expect(
      authorize(db, b.user, { restaurantId: ra.restaurantId, roles: ROLES }),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    expect((await screens(b.user, ra.restaurantId)).access.restaurantId).toBe(rb.restaurantId);
  });

  it('elegir el restaurante activo solo cambia entre los propios (nunca a uno ajeno)', async () => {
    const a = await registered('Con dos');
    const first = await newRestaurant(a.user, 'Primero de A');
    const second = await newRestaurant(a.user, 'Segundo de A');
    const other = await registered('Ajeno');
    const foreign = await newRestaurant(other.user, 'De otro');

    // Lo que valida "Usar este" en Mi sesión: la lista del usuario.
    const mine = (await listUserRestaurants(db, a.user.id)).map((r) => r.restaurantId);
    expect(mine).toEqual([first.restaurantId, second.restaurantId]);
    expect(mine).not.toContain(foreign.restaurantId);

    expect((await screens(a.user, second.restaurantId)).summary?.name).toBe('Segundo de A');
    expect((await screens(a.user, first.restaurantId)).summary?.name).toBe('Primero de A');
    // Una cookie con un restaurante ajeno se ignora: vuelve al primero propio.
    expect((await screens(a.user, foreign.restaurantId)).summary?.name).toBe('Primero de A');
  });

  it('una cuenta sin restaurante no llega a los datos de ningún restaurante', async () => {
    const owner = await registered('Con local');
    const target = await newRestaurant(owner.user, 'Con datos');
    const empty = await registered('Sin local');
    for (const preferred of [undefined, target.restaurantId]) {
      await expect(screens(empty.user, preferred)).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    }
    await expect(
      authorize(db, empty.user, { restaurantId: target.restaurantId, roles: ROLES }),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
  });
});
