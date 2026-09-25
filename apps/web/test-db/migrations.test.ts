import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, inject, it } from 'vitest';

/*
 * Los demás tests arman la base con el DDL de schema.prisma + sql/0001_constraints.sql.
 * A Neon llega otra cosa: prisma/migrations/. Estos tests garantizan que ambas son la misma base.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const CONSTRAINTS_SQL = readFileSync(
  fileURLToPath(new URL('../prisma/sql/0001_constraints.sql', import.meta.url)),
  'utf8',
);

const migrationNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const migrationSql = (name: string): string =>
  readFileSync(`${MIGRATIONS_DIR}${name}/migration.sql`, 'utf8');

interface Catalog {
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
  triggers: unknown[];
  functions: unknown[];
  enums: unknown[];
}

/** Todo lo que define el esquema, en forma comparable (sin datos ni OIDs). */
async function catalog(db: PGlite): Promise<Catalog> {
  const q = async (sql: string): Promise<unknown[]> => (await db.query(sql)).rows;
  return {
    columns: await q(`
      SELECT table_name, column_name, udt_name, is_nullable, column_default,
             numeric_precision, numeric_scale
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`),
    constraints: await q(`
      SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      ORDER BY tbl, conname`),
    indexes: await q(`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
    triggers: await q(`
      SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
      WHERE NOT tgisinternal ORDER BY tgname`),
    functions: await q(`
      SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      ORDER BY proname`),
    enums: await q(`
      SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      ORDER BY t.typname, e.enumsortorder`),
  };
}

describe('migraciones (prisma/migrations)', () => {
  it('la migración inicial termina con una copia literal de sql/0001_constraints.sql', () => {
    const [initial] = migrationNames();
    expect(initial).toMatch(/_init$/);
    expect(migrationSql(initial ?? '').endsWith(CONSTRAINTS_SQL)).toBe(true);
  });

  it('aplicar las migraciones en orden produce exactamente la base que prueban los demás tests', async () => {
    const fromMigrations = new PGlite();
    const reference = new PGlite();
    try {
      for (const name of migrationNames()) {
        await fromMigrations.exec(migrationSql(name));
      }
      await reference.exec(inject('ddl'));
      await reference.exec(CONSTRAINTS_SQL);

      const expected = await catalog(reference);
      expect(expected.triggers.length).toBeGreaterThan(0);
      expect(await catalog(fromMigrations)).toEqual(expected);
    } finally {
      await fromMigrations.close();
      await reference.close();
    }
  });
});
