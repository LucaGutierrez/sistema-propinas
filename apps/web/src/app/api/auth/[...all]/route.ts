/**
 * Rutas HTTP de Better Auth (/api/auth/*): iniciar/cerrar sesión, leer la sesión.
 * La instancia se obtiene en cada pedido (no al importar el módulo) para que `next build` no
 * necesite BETTER_AUTH_SECRET.
 */
import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/server/auth/auth';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
