import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { describe, expect, inject, it } from 'vitest';

/*
 * Los demás tests arman la base con el DDL de schema.prisma + sql/constraints.sql (el conjunto
 * vigente de restricciones). A Neon llega otra cosa: prisma/migrations/, donde cada migración
 * embebe su delta de SQL (sql/0001_constraints.sql, sql/0002_distribution_policies.sql, ...).
 * Estos tests garantizan que ambas son la misma base.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const sqlFile = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../prisma/sql/${name}`, import.meta.url)), 'utf8');

const CONSTRAINTS_SQL = sqlFile('constraints.sql');

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
    expect(migrationSql(initial ?? '').endsWith(sqlFile('0001_constraints.sql'))).toBe(true);
  });

  it('la migración de políticas termina con una copia literal de sql/0002_distribution_policies.sql', () => {
    const policies = migrationNames().find((name) => name.endsWith('_distribution_policies'));
    expect(policies).toBeDefined();
    expect(migrationSql(policies ?? '').endsWith(sqlFile('0002_distribution_policies.sql'))).toBe(
      true,
    );
  });

  it('la migración de políticas no se aplica sobre datos existentes (guarda explícita)', async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      const [initial, policies] = migrationNames();
      await db.exec(migrationSql(initial ?? ''));
      await db.exec(
        `INSERT INTO restaurants (id, name, pool_mode, updated_at)
         VALUES ('00000000-0000-0000-0000-000000000010', 'Demo', 'SINGLE', now());`,
      );
      await expect(db.exec(migrationSql(policies ?? ''))).rejects.toThrow(/MIGRATION GUARD/);
    } finally {
      await db.close();
    }
  });

  it('la migración de autenticación termina con una copia literal de sql/0003_auth.sql', () => {
    const auth = migrationNames().find((name) => name.endsWith('_auth'));
    expect(auth).toBeDefined();
    expect(migrationSql(auth ?? '').endsWith(sqlFile('0003_auth.sql'))).toBe(true);
  });

  /** Base con las migraciones anteriores a la de autenticación y un restaurante con su OWNER. */
  async function beforeAuth(role: string, email = 'operador@example.com'): Promise<PGlite> {
    const db = new PGlite({ extensions: { btree_gist } });
    for (const name of migrationNames().filter((n) => !n.endsWith('_auth'))) {
      await db.exec(migrationSql(name));
    }
    await db.exec(`
      INSERT INTO users (id, email, name, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000001', '${email}', 'Operador', now());
      INSERT INTO restaurants (id, name, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000010', 'Demo', now());
      INSERT INTO memberships (user_id, restaurant_id, role, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010',
                '${role}', now());`);
    return db;
  }

  it('la migración de autenticación conserva usuarios y membresías existentes', async () => {
    const db = await beforeAuth('OWNER');
    try {
      const auth = migrationNames().find((name) => name.endsWith('_auth'));
      await db.exec(migrationSql(auth ?? ''));
      const rows = await db.query<{ email: string; email_verified: boolean; role: string }>(
        `SELECT u.email, u.email_verified, m.role::text AS role
         FROM users u JOIN memberships m ON m.user_id = u.id`,
      );
      expect(rows.rows).toEqual([
        { email: 'operador@example.com', email_verified: false, role: 'OWNER' },
      ]);
    } finally {
      await db.close();
    }
  });

  it.each([
    ['una membresía ADMIN', 'ADMIN', 'operador@example.com'],
    ['un email con mayúsculas', 'OWNER', 'Operador@Example.com'],
  ])(
    'la migración de autenticación no se aplica con %s (guarda explícita)',
    async (_, role, email) => {
      const db = await beforeAuth(role, email);
      try {
        const auth = migrationNames().find((name) => name.endsWith('_auth'));
        await expect(db.exec(migrationSql(auth ?? ''))).rejects.toThrow(/MIGRATION GUARD/);
        const rows = await db.query<{ role: string }>(`SELECT role::text AS role FROM memberships`);
        expect(rows.rows).toEqual([{ role }]);
      } finally {
        await db.close();
      }
    },
  );

  it('la migración M1 (participación) termina con una copia literal de sql/0004_participation.sql', () => {
    const m1 = migrationNames().find((name) => name.endsWith('_participation_methods'));
    expect(m1).toBeDefined();
    expect(migrationSql(m1 ?? '').endsWith(sqlFile('0004_participation.sql'))).toBe(true);
  });

  it('la migración M1 conserva los datos existentes: BY_POSITION, DECIMAL y 1,00 punto', async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      for (const name of migrationNames().filter((n) => !n.endsWith('_participation_methods'))) {
        await db.exec(migrationSql(name));
      }
      // Un restaurante como el de production: política v1 estándar, un puesto y dos empleados,
      // y un reparto CERRADO con su ítem (porción 0,022).
      await db.exec(`
        INSERT INTO users (id, email, name, updated_at)
          VALUES ('00000000-0000-0000-0000-000000000001', 'owner@example.com', 'Dueño', now());
        INSERT INTO restaurants (id, name, updated_at)
          VALUES ('00000000-0000-0000-0000-000000000010', 'Local', now());
        INSERT INTO positions (id, restaurant_id, name, updated_at)
          VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010',
                  'Salón', now());
        BEGIN;
        INSERT INTO distribution_policy_versions (id, restaurant_id, number, origin, template_code,
            template_version, summary, period_kind, period_start_weekday, split_timing, hours_basis,
            hours_entry, pot_sources, pool_structure, portion_mode, rounding_unit,
            advance_deduction, envelope_handlers, created_by)
          VALUES ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000010', 1,
            'STANDARD', 'gutip-standard', 1, 'Estándar', 'WEEKLY', 1, 'PER_PERIOD', 'PERIOD_TOTAL',
            'PERIOD_TOTAL_AT_CLOSE', 'SINGLE_DAILY_AMOUNT', 'SINGLE_POOL', 'BY_POSITION', 'CENT',
            'WHOLE_PERIOD', 'MANAGER_ONLY', '00000000-0000-0000-0000-000000000001');
        INSERT INTO policy_version_positions (version_id, position_id, portion)
          VALUES ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000030',
                  0.022);
        COMMIT;
        UPDATE restaurants SET current_policy_version_id = '00000000-0000-0000-0000-000000000050';
        INSERT INTO employees (id, restaurant_id, first_name, last_name, default_position_id, updated_at)
          VALUES ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000010',
                  'Roro', '', '00000000-0000-0000-0000-000000000030', now()),
                 ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000010',
                  'Leo', '', '00000000-0000-0000-0000-000000000030', now());
        INSERT INTO daily_distributions (id, restaurant_id, scope, date_from, date_to, created_by, updated_at)
          VALUES ('00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000010',
                  'PERIOD', '2026-09-21', '2026-09-27', '00000000-0000-0000-0000-000000000001', now());
        INSERT INTO tip_entries (daily_distribution_id, entry_date, currency, amount_cents,
            amount_ars_cents, updated_at)
          VALUES ('00000000-0000-0000-0000-000000000060', '2026-09-27', 'ARS', 1000, 1000, now());
        INSERT INTO daily_distribution_items (id, daily_distribution_id, employee_id, position_id,
            employee_name_snapshot, position_name_snapshot, portion_snapshot, hours, points,
            percentage, amount_cents, advances_cents, final_cents)
          VALUES ('00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000060',
                  '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030',
                  'Roro', 'Salón', 0.022, 45, 0.99, 1, 1000, 0, 1000);
        UPDATE daily_distributions SET status = 'CLOSED', closed_at = now(),
            closed_by = '00000000-0000-0000-0000-000000000001', tips_ars_cents = 1000,
            total_cents = 1000, total_points = 0.99, total_final_cents = 1000
          WHERE id = '00000000-0000-0000-0000-000000000060';`);

      const m1 = migrationNames().find((name) => name.endsWith('_participation_methods'));
      await db.exec(migrationSql(m1 ?? ''));

      const q = async (sql: string) => (await db.query(sql)).rows;
      expect(await q(`SELECT portion_display::text AS d FROM restaurants`)).toEqual([
        { d: 'DECIMAL' },
      ]);
      expect(await q(`SELECT portion_mode::text AS m FROM distribution_policy_versions`)).toEqual([
        { m: 'BY_POSITION' },
      ]);
      expect(
        await q(
          `SELECT first_name, individual_points::text AS p FROM employees ORDER BY first_name`,
        ),
      ).toEqual([
        { first_name: 'Leo', p: '1.00' },
        { first_name: 'Roro', p: '1.00' },
      ]);
      // El ítem cerrado no cambió: conserva su porción y no tiene puntos (no intervinieron).
      expect(
        await q(`SELECT portion_snapshot::text AS portion, individual_points_snapshot AS points,
                        points::text AS weight, amount_cents::text AS amount
                 FROM daily_distribution_items`),
      ).toEqual([
        { portion: '0.0220000000', points: null, weight: '0.990000000000', amount: '1000' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('aplicar las migraciones en orden produce exactamente la base que prueban los demás tests', async () => {
    const fromMigrations = new PGlite({ extensions: { btree_gist } });
    const reference = new PGlite({ extensions: { btree_gist } });
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
