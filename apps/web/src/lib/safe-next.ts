/**
 * Destino seguro después del login (`/login?next=…`): solo rutas internas de la aplicación.
 * Evita redirecciones abiertas a otros sitios (`//evil.com`, `https://…`, `/\evil.com`).
 * Sin `next` válido vuelve a `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
