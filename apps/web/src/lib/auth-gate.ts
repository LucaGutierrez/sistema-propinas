/**
 * Filtro previo del middleware: ¿este pedido va derecho al login?
 *
 * Solo mira si EXISTE la cookie de sesión (sin base, sin validarla). No es autorización: cada
 * página y acción vuelve a validar la sesión con Better Auth y la membresía con `requireAccess`.
 * Sirve para que un pedido sin sesión reciba un 307 al login al instante, en lugar de renderizar
 * la pantalla (con su esqueleto de carga) y redirigir después.
 */

/** Nombres de la cookie de sesión de Better Auth con `cookiePrefix: 'gutip'` (http y https). */
export const SESSION_COOKIES = ['gutip.session_token', '__Secure-gutip.session_token'] as const;

/** Rutas que se ven sin sesión (además de los archivos de Next y los estáticos). */
const PUBLIC_PREFIXES = ['/login', '/registro', '/api/', '/_next/', '/icon'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/** Destino del login para un pedido sin sesión, o null si puede seguir. */
export function loginRedirect(input: {
  pathname: string;
  search: string;
  hasSessionCookie: boolean;
}): string | null {
  if (input.hasSessionCookie || isPublicPath(input.pathname)) return null;
  const next = `${input.pathname}${input.search}`;
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
