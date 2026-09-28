import { describe, expect, it } from 'vitest';
import { DEV_ORIGIN, trustedOriginsFrom } from './trusted-origins';

/** Entorno de un deployment de Production en Vercel (lo que Vercel inyecta). */
const VERCEL_PRODUCTION = {
  NODE_ENV: 'production',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_URL: 'sistema-propinas-3tjabc123-guti3.vercel.app',
  VERCEL_BRANCH_URL: 'sistema-propinas-git-main-guti3.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'sistema-propinas.vercel.app',
};

describe('trustedOriginsFrom', () => {
  it('en Vercel confía en el dominio canónico y en los hosts exactos del deployment, por HTTPS', () => {
    expect(trustedOriginsFrom(VERCEL_PRODUCTION)).toEqual([
      'https://sistema-propinas-3tjabc123-guti3.vercel.app',
      'https://sistema-propinas-git-main-guti3.vercel.app',
      'https://sistema-propinas.vercel.app',
    ]);
  });

  it('nunca confía en un comodín ni en otro sitio de vercel.app', () => {
    const origins = trustedOriginsFrom(VERCEL_PRODUCTION);
    expect(origins.some((o) => o.includes('*'))).toBe(false);
    expect(origins).not.toContain('https://attacker.vercel.app');
    expect(origins).not.toContain('https://evil.example');
    expect(origins.every((o) => o.startsWith('https://'))).toBe(true);
  });

  it('localhost solo en desarrollo', () => {
    expect(trustedOriginsFrom(VERCEL_PRODUCTION)).not.toContain(DEV_ORIGIN);
    expect(trustedOriginsFrom({ NODE_ENV: 'production' })).toEqual([]);
    expect(trustedOriginsFrom({ NODE_ENV: 'test' })).toEqual([]);
    expect(trustedOriginsFrom({ NODE_ENV: 'development' })).toEqual([DEV_ORIGIN]);
  });

  it('fuera de Vercel ignora variables VERCEL_* sueltas', () => {
    expect(
      trustedOriginsFrom({ NODE_ENV: 'production', VERCEL_URL: 'sistema-propinas.vercel.app' }),
    ).toEqual([]);
  });

  it.each([
    'https://evil.example',
    'evil.example/ruta',
    'evil.example:8080',
    '*.vercel.app',
    'localhost',
    '',
    '   ',
  ])('descarta un host mal formado: %j', (host) => {
    expect(trustedOriginsFrom({ VERCEL: '1', VERCEL_URL: host })).toEqual([]);
  });
});
