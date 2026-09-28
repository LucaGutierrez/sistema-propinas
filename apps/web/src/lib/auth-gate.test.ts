import { describe, expect, it } from 'vitest';
import { loginRedirect } from './auth-gate';

const go = (pathname: string, hasSessionCookie: boolean, search = '') =>
  loginRedirect({ pathname, search, hasSessionCookie });

describe('filtro previo del middleware', () => {
  it('sin cookie de sesión, las pantallas de la app van al login con el destino', () => {
    expect(go('/', false)).toBe('/login');
    expect(go('/reparto', false)).toBe('/login?next=%2Freparto');
    expect(go('/reparto/abc', false, '?cerrado=1')).toBe(
      '/login?next=%2Freparto%2Fabc%3Fcerrado%3D1',
    );
    expect(go('/personal', false)).toBe('/login?next=%2Fpersonal');
  });

  it('con cookie sigue (la sesión la valida la página), y lo público nunca redirige', () => {
    expect(go('/reparto', true)).toBeNull();
    for (const path of [
      '/login',
      '/registro',
      '/api/auth/sign-in/email',
      '/_next/data/x',
      '/icon.svg',
    ]) {
      expect(go(path, false)).toBeNull();
    }
  });
});
