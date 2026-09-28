import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveAccess } from '@/server/access/access';
import { ROLES } from '@/server/access/roles';
import { createAuth, type Auth } from '@/server/auth/auth';
import { setCredentialPassword } from '@/server/auth/credentials';
import { sessionUserFrom } from '@/server/auth/session';
import { trustedOriginsFrom } from '@/server/auth/trusted-origins';
import { bootstrapRestaurant } from '@/server/policy/service';

/*
 * Better Auth de punta a punta sobre NUESTRAS tablas (users, accounts, sessions,
 * auth_rate_limits) en PostgreSQL real: el mismo camino que /api/auth/* en la aplicación.
 * Prueba la transición del dueño creado por db:bootstrap (sin contraseña) a una cuenta con la
 * que se inicia sesión, sin duplicar el usuario.
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

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Cada login viene de una IP distinta salvo que se indique (el límite es por IP). */
let nextIp = 1;
const signIn = (email: string, password: string, ip = `203.0.113.${nextIp++}`) =>
  post('/sign-in/email', { email, password }, { 'x-forwarded-for': ip });

/** Cookie de sesión (nombre=valor) de un Set-Cookie. */
function sessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith('gutip.session_token='));
  if (!cookie) throw new Error('no llegó la cookie de sesión');
  return cookie.split(';')[0] ?? '';
}

/** Dueño creado por db:bootstrap (como el de Neon): existe en users, sin contraseña. */
async function bootstrappedOwner() {
  const input = {
    restaurantId: randomUUID(),
    restaurantName: 'Local',
    operatorEmail: `Dueno-${randomUUID()}@Example.invalid`,
    operatorName: 'Dueño',
  };
  const result = await bootstrapRestaurant(db, input);
  if (!result.ok) throw new Error(result.error);
  return { ...input, email: input.operatorEmail.toLowerCase(), userId: result.value.userId };
}

describe('dueño existente → cuenta de Better Auth', () => {
  it('sin contraseña no puede iniciar sesión', async () => {
    const owner = await bootstrappedOwner();
    expect((await signIn(owner.email, PASSWORD)).status).toBe(401);
  });

  it('db:operator-password agrega la cuenta al MISMO usuario y con ella se inicia sesión', async () => {
    const owner = await bootstrappedOwner();
    const set = await setCredentialPassword(db, owner.operatorEmail, PASSWORD);
    expect(set).toEqual({
      ok: true,
      value: { userId: owner.userId, created: true, revokedSessions: 0 },
    });

    // Solo el hash (scrypt) en accounts; ningún usuario nuevo.
    const account = await db.account.findFirstOrThrow({ where: { userId: owner.userId } });
    expect(account).toMatchObject({ providerId: 'credential', accountId: owner.userId });
    expect(account.password).not.toContain(PASSWORD);
    expect(await db.user.count({ where: { email: owner.email } })).toBe(1);

    const response = await signIn(owner.email, PASSWORD);
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);

    const user = await sessionUserFrom(auth, new Headers({ cookie }));
    expect(user).toEqual({ id: owner.userId, email: owner.email, name: 'Dueño' });
    // La sesión real habilita el acceso real a su restaurante.
    const access = await resolveAccess(db, user, {
      restaurantId: owner.restaurantId,
      roles: ROLES,
    });
    expect(access.role).toBe('OWNER');
    expect(await db.user.count({ where: { email: owner.email } })).toBe(1);
  });

  it('no crea usuarios: con un email inexistente no hace nada', async () => {
    const email = `nadie-${randomUUID()}@example.invalid`;
    expect(await setCredentialPassword(db, email, PASSWORD)).toMatchObject({ ok: false });
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it('exige --reset para reemplazar la contraseña y al hacerlo cierra las sesiones', async () => {
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);
    const cookie = sessionCookie(await signIn(owner.email, PASSWORD));

    expect(await setCredentialPassword(db, owner.email, 'otra-contraseña-2')).toMatchObject({
      ok: false,
    });
    const reset = await setCredentialPassword(db, owner.email, 'otra-contraseña-2', {
      reset: true,
    });
    expect(reset).toMatchObject({ ok: true, value: { created: false, revokedSessions: 1 } });

    expect(await sessionUserFrom(auth, new Headers({ cookie }))).toBeNull();
    expect((await signIn(owner.email, PASSWORD)).status).toBe(401);
    expect((await signIn(owner.email, 'otra-contraseña-2')).status).toBe(200);
  });

  it('rechaza contraseñas cortas', async () => {
    const owner = await bootstrappedOwner();
    expect(await setCredentialPassword(db, owner.email, 'corta')).toMatchObject({ ok: false });
    expect(await db.account.count({ where: { userId: owner.userId } })).toBe(0);
  });
});

describe('sesión', () => {
  it('la cookie es httpOnly, SameSite=Lax, con prefijo propio (Secure solo en producción)', async () => {
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);
    const raw = (await signIn(owner.email, PASSWORD)).headers
      .getSetCookie()
      .find((c) => c.startsWith('gutip.session_token='));
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).not.toMatch(/Secure/i); // en tests NODE_ENV no es production
  });

  it('una cookie inventada o manipulada no es una sesión', async () => {
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);
    const cookie = sessionCookie(await signIn(owner.email, PASSWORD));
    const tampered = `${cookie.slice(0, -4)}AAAA`;
    expect(await sessionUserFrom(auth, new Headers({ cookie: tampered }))).toBeNull();
    expect(
      await sessionUserFrom(auth, new Headers({ cookie: 'gutip.session_token=falso' })),
    ).toBeNull();
    expect(await sessionUserFrom(auth, new Headers())).toBeNull();
  });

  it('cerrar sesión borra la sesión en la base y la cookie deja de servir', async () => {
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);
    const cookie = sessionCookie(await signIn(owner.email, PASSWORD));
    expect(await db.session.count({ where: { userId: owner.userId } })).toBe(1);

    const out = await post('/sign-out', {}, { cookie });
    expect(out.status).toBe(200);
    expect(await db.session.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await sessionUserFrom(auth, new Headers({ cookie }))).toBeNull();
  });

  it('el registro público está deshabilitado', async () => {
    const email = `nuevo-${randomUUID()}@example.invalid`;
    const response = await post('/sign-up/email', { email, password: PASSWORD, name: 'Nuevo' });
    expect(response.ok).toBe(false);
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it('rechaza pedidos con la cookie de sesión desde otro origen (CSRF)', async () => {
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);
    const cookie = sessionCookie(await signIn(owner.email, PASSWORD));
    const forged = await post('/sign-out', {}, { cookie, origin: 'https://evil.example' });
    expect(forged.status).toBe(403);
    expect(await db.session.count({ where: { userId: owner.userId } })).toBe(1);
    // Sin encabezado Origin tampoco.
    const noOrigin = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{}',
      }),
    );
    expect(noOrigin.status).toBe(403);
    expect(await sessionUserFrom(auth, new Headers({ cookie }))).not.toBeNull();
  });

  it('orígenes en Vercel: dominio canónico y hosts exactos del deployment sí; otros no', async () => {
    const CANONICAL = 'https://sistema-propinas.vercel.app';
    const DEPLOYMENT = 'https://sistema-propinas-3tjabc123-guti3.vercel.app';
    const BRANCH = 'https://sistema-propinas-git-main-guti3.vercel.app';
    const secret = `test-secret-${randomUUID()}-${randomUUID()}`;
    // Como en Vercel: BETTER_AUTH_URL = dominio canónico; hosts del deployment desde el entorno.
    const vercelAuth = createAuth(db, {
      secret,
      baseURL: CANONICAL,
      trustedOrigins: trustedOriginsFrom({
        NODE_ENV: 'production',
        VERCEL: '1',
        VERCEL_URL: DEPLOYMENT.slice('https://'.length),
        VERCEL_BRANCH_URL: BRANCH.slice('https://'.length),
        VERCEL_PROJECT_PRODUCTION_URL: CANONICAL.slice('https://'.length),
      }),
    });
    // La configuración anterior (solo BETTER_AUTH_URL): reproduce el "Invalid origin".
    const before = createAuth(db, { secret, baseURL: CANONICAL });
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);

    // Login desde el host que usa el navegador. Con una cookie ya presente (p. ej. la de la
    // protección de deployments de Vercel), Better Auth exige que el origen sea de confianza.
    const login = (instance: Auth, origin: string) =>
      instance.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin,
            cookie: '_vercel_jwt=prueba',
            'x-forwarded-for': `203.0.113.${nextIp++}`,
          },
          body: JSON.stringify({ email: owner.email, password: PASSWORD }),
        }),
      );

    expect((await login(before, DEPLOYMENT)).status).toBe(403);
    for (const origin of [CANONICAL, DEPLOYMENT, BRANCH]) {
      expect({ origin, status: (await login(vercelAuth, origin)).status }).toEqual({
        origin,
        status: 200,
      });
    }
    for (const origin of [
      'https://attacker.vercel.app',
      'https://sistema-propinas-evil.vercel.app',
      'https://evil.example',
      'http://sistema-propinas.vercel.app',
      'http://localhost:3000',
    ]) {
      expect({ origin, status: (await login(vercelAuth, origin)).status }).toEqual({
        origin,
        status: 403,
      });
    }
  });

  it('limita los intentos de login por IP (guardado en auth_rate_limits)', async () => {
    const owner = await bootstrappedOwner();
    await setCredentialPassword(db, owner.email, PASSWORD);
    const ip = '198.51.100.7';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await signIn(owner.email, 'mala-contraseña', ip)).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    // Bloqueado aun con la contraseña correcta; otra IP no se ve afectada.
    expect((await signIn(owner.email, PASSWORD, ip)).status).toBe(429);
    expect((await signIn(owner.email, PASSWORD, '198.51.100.8')).status).toBe(200);
    expect(await db.authRateLimit.count({ where: { key: { startsWith: ip } } })).toBe(1);
  });
});
