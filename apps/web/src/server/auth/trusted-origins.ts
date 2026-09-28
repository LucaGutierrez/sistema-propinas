/**
 * Orígenes de confianza de Better Auth, ADEMÁS de BETTER_AUTH_URL (que Better Auth ya incluye).
 *
 * En Vercel la app responde también en hosts propios de cada deployment (el único del deployment
 * y el de la rama), además del dominio canónico. Esos hosts los inyecta Vercel en el entorno
 * (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`): se confía en esos hosts
 * EXACTOS, siempre por HTTPS. Nunca en un comodín como `*.vercel.app`, que incluiría sitios de
 * cualquier usuario de Vercel. El origen nunca sale del pedido: sale del entorno del deployment.
 *
 * `http://localhost:3000` solo en desarrollo (`NODE_ENV=development`).
 */

type Env = Readonly<Record<string, string | undefined>>;

export const DEV_ORIGIN = 'http://localhost:3000';

const VERCEL_HOST_VARS = ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];

/** `https://<host>` si `host` es un nombre de host limpio (sin esquema, puerto, ruta ni comodín). */
function httpsOrigin(host: string | undefined): string | null {
  const value = host?.trim().toLowerCase();
  if (!value || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return null;
  }
  return `https://${value}`;
}

export function trustedOriginsFrom(env: Env): string[] {
  const origins = new Set<string>();
  if (env.VERCEL === '1') {
    for (const name of VERCEL_HOST_VARS) {
      const origin = httpsOrigin(env[name]);
      if (origin) origins.add(origin);
    }
  }
  if (env.NODE_ENV === 'development') origins.add(DEV_ORIGIN);
  return [...origins];
}
