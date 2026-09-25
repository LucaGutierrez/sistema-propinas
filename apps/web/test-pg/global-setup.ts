import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL de la base temporal creada para esta corrida (ya migrada). */
    pgUrl: string;
  }
}

const webDir = fileURLToPath(new URL('..', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Ejecuta la CLI de Prisma contra `databaseUrl` y devuelve su salida. */
export function prisma(args: string[], databaseUrl: string): string {
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: webDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

/**
 * Crea una base temporal en el servidor de TEST_DATABASE_URL, le aplica las migraciones con
 * `prisma migrate deploy` (el mismo flujo que producción) y la borra al terminar.
 *
 * TEST_DATABASE_URL debe apuntar a un PostgreSQL descartable (local o el servicio del CI) con
 * permiso CREATEDB. Nunca a Neon ni a una base con datos: se rechazan hosts de Neon.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it to a disposable PostgreSQL (see README: pnpm test:pg).',
    );
  }
  const url = new URL(adminUrl);
  if (url.hostname.endsWith('neon.tech')) {
    throw new Error('Refusing to run concurrency tests against Neon: use a disposable PostgreSQL.');
  }

  const dbName = `propinas_pg_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);

  url.pathname = `/${dbName}`;
  const testUrl = url.toString();
  prisma(['migrate', 'deploy'], testUrl);
  project.provide('pgUrl', testUrl);

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  };
}
