/**
 * Autenticación con Better Auth (solo servidor). Se apoya en NUESTRAS tablas:
 *
 *   users          → modelo `user` de Better Auth (la misma tabla que usa el resto del sistema)
 *   sessions       → sesiones (la cookie lleva el token firmado; revocar = borrar la fila)
 *   accounts       → email y contraseña: providerId "credential", `password` = hash scrypt
 *   verifications  → tokens de verificación / recuperación (todavía sin uso: no hay mailer)
 *   auth_rate_limits → límite de intentos compartido entre instancias (serverless)
 *
 * La AUTORIZACIÓN no es de Better Auth: vive en `restaurants` + `memberships` y la resuelve
 * `server/access` en cada pedido. No se usa el plugin de organizaciones.
 *
 * Secretos por entorno (nunca en el código): BETTER_AUTH_SECRET (≥ 32 caracteres aleatorios) y
 * BETTER_AUTH_URL (origen público, p. ej. http://localhost:3000). La instancia se crea recién en
 * el primer uso para que `next build` no necesite el secreto.
 */
import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getDb } from '../db';
import { signUpBodyError } from './sign-up';
import { trustedOriginsFrom } from './trusted-origins';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/** Duración de la sesión (se renueva sola con el uso, una vez por día). */
const SESSION_DAYS = 7;

/** Registros por IP y por hora (además del límite general de Better Auth para /sign-up). */
export const SIGN_UP_PER_HOUR = 5;

/**
 * Valida el cuerpo del registro ANTES de que Better Auth busque el email: el resultado es el
 * mismo exista o no la cuenta. Ver sign-up.ts.
 */
const signUpGuard = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-up/email') return;
  const error = signUpBodyError(ctx.body);
  if (error) throw new APIError('BAD_REQUEST', { message: error, code: 'INVALID_SIGN_UP' });
});

export interface AuthOverrides {
  /** Solo para tests: en la aplicación salen de BETTER_AUTH_SECRET / BETTER_AUTH_URL. */
  secret?: string;
  baseURL?: string;
  /** Solo para tests: en la aplicación salen del entorno (`trustedOriginsFrom`). */
  trustedOrigins?: string[];
}

export function createAuth(db: PrismaClient, overrides: AuthOverrides = {}) {
  return betterAuth({
    appName: 'GUTIP',
    secret: overrides.secret,
    baseURL: overrides.baseURL,
    // Hosts exactos del deployment de Vercel (y localhost en desarrollo); ver trusted-origins.ts.
    trustedOrigins: overrides.trustedOrigins ?? trustedOriginsFrom(process.env),
    database: prismaAdapter(db, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      // Registro público (/registro): SOLO crea la cuenta; nunca restaurantes ni membresías.
      // Sin inicio de sesión automático: así Better Auth responde lo mismo si el email ya
      // existe (hashea igual la contraseña y no crea nada), y no se puede averiguar qué emails
      // están registrados. La pantalla inicia sesión después con las mismas credenciales.
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    hooks: { before: signUpGuard },
    databaseHooks: {
      user: {
        create: {
          // El nombre se guarda sin espacios de más (la validación ya corrió en signUpGuard).
          before: async (user) => ({ data: { ...user, name: user.name.trim() } }),
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * SESSION_DAYS,
      updateAge: 60 * 60 * 24,
      // Sin caché de sesión en cookie: cerrar o revocar una sesión corta el acceso al instante.
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'authRateLimit',
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: SIGN_UP_PER_HOUR },
        // Consultar la sesión no es un intento de acceso: sin contador (en base, cada llamada
        // sumaba 4 consultas a Neon antes de responder).
        '/get-session': false,
      },
    },
    advanced: {
      cookiePrefix: 'gutip',
      // httpOnly y sameSite=lax siempre (Better Auth); `secure` en producción (HTTPS).
      useSecureCookies: process.env.NODE_ENV === 'production',
      // Los ids de nuestras tablas son uuid.
      database: { generateId: 'uuid' },
      // Explícitos: Better Auth los apaga solo en entorno de test; así los tests prueban lo mismo
      // que corre en producción (pedidos con cookie desde otro origen → 403).
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { gutipAuth?: Auth };

/** Instancia de la aplicación (una por proceso). */
export function getAuth(): Auth {
  globalForAuth.gutipAuth ??= createAuth(getDb());
  return globalForAuth.gutipAuth;
}
