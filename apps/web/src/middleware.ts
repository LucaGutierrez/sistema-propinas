import { NextResponse, type NextRequest } from 'next/server';
import { loginRedirect, SESSION_COOKIES } from '@/lib/auth-gate';

/**
 * Sin cookie de sesión → 307 al login antes de renderizar nada (modo base de datos). No valida la
 * sesión ni da acceso: eso lo hacen las páginas y acciones en cada pedido (ver lib/auth-gate.ts).
 */
export function middleware(request: NextRequest) {
  if (process.env.GUTIP_DATA_SOURCE !== 'database') return NextResponse.next();
  const target = loginRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSessionCookie: SESSION_COOKIES.some((name) => request.cookies.has(name)),
  });
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, request.url), 307);
}

export const config = {
  // Todo menos los archivos internos de Next y los estáticos.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
