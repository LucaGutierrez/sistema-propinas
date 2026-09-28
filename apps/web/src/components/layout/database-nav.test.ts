import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATABASE_ACCOUNT_NAV, DATABASE_VENUE_NAV, DEMO_ONLY_ROUTES } from './database-nav';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/** Todas las páginas de la app (`src/app/**\/page.tsx`), con su ruta relativa a src. */
function pages(dir = join(SRC, 'app')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path.slice(SRC.length).replaceAll('\\', '/')] : [];
  });
}

/** Imports que traen la demo (datos ficticios del navegador). */
const DEMO_IMPORT =
  /from '@\/(lib\/demo-store|components\/(week|venues|access)\/|components\/[^']*demo-[^']*)/;

describe('modo base de datos: sin demo', () => {
  it('el menú solo tiene pantallas que leen la base', () => {
    expect(DATABASE_VENUE_NAV.map((i) => i.href)).toEqual([
      '/',
      '/reparto',
      '/historial',
      '/sobres',
      '/personal',
      '/configuracion',
    ]);
    expect(DATABASE_ACCOUNT_NAV.map((i) => i.href)).toEqual(['/cuenta', '/crear-restaurante']);
  });

  it('ninguna pantalla de la demo aparece en el menú', () => {
    const hrefs = [...DATABASE_VENUE_NAV, ...DATABASE_ACCOUNT_NAV].map((i) => i.href);
    for (const route of DEMO_ONLY_ROUTES) expect(hrefs).not.toContain(route);
  });

  it('el shell y el menú del modo base no importan nada de la demo', () => {
    for (const file of [
      'components/layout/database-shell.tsx',
      'components/layout/database-nav.ts',
    ]) {
      expect({ file, demo: DEMO_IMPORT.test(read(file)) }).toEqual({ file, demo: false });
    }
  });

  it('toda página que puede mostrar la demo decide antes en el servidor si la base está activa', () => {
    const offenders = pages().filter((page) => {
      const source = read(page);
      return DEMO_IMPORT.test(source) && !source.includes('databaseEnabled()');
    });
    expect(offenders).toEqual([]);
  });

  it('las pantallas que todavía son de la demo no la muestran en modo base', () => {
    for (const route of DEMO_ONLY_ROUTES) {
      const page = `app${route}/page.tsx`;
      const source = read(page);
      expect({
        page,
        guarded: /if \(databaseEnabled\(\)\) (return|redirect)/.test(source),
      }).toEqual({ page, guarded: true });
    }
    expect(read('app/semanas/[id]/page.tsx')).toMatch(/if \(databaseEnabled\(\)\) redirect/);
  });

  it('el layout decide el modo en el servidor y no se prerenderiza con la demo', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toMatch(/databaseEnabled\(\)/);
    expect(layout).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});
