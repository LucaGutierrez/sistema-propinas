import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';

/*
 * Tests de concurrencia contra un PostgreSQL real (varias conexiones simultáneas; PGlite solo
 * tiene una). Como las transacciones se confirman, no se pueden revertir al final del test ni
 * borrar (los triggers impiden DELETE en adelantos y bitácoras): cada test crea su propio
 * restaurante y así no comparte filas con los demás.
 */

export interface Session {
  /** PID del backend de PostgreSQL de esta conexión. */
  readonly pid: number;
  query<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

export interface Fixture {
  restaurant: string;
  user: string;
  position: string;
  /** Versión 1 (estándar) de la política del restaurante, vigente. */
  policyVersion: string;
  /** Dos empleados del restaurante. */
  employees: [string, string];
}

export interface Pg {
  /** Abre una conexión nueva (se cierra al terminar el test, con ROLLBACK si quedó abierta). */
  connect(): Promise<Session>;
  /** Restaurante nuevo con dos equipos, un puesto, dos empleados y la política estándar (v1). */
  fixture(): Promise<Fixture & { teams: [string, string] }>;
  /** Espera hasta que la conexión `pid` esté bloqueada esperando un lock de otra transacción. */
  waitUntilBlocked(pid: number): Promise<void>;
}

export function usePg(): Pg {
  const url = inject('pgUrl');
  let admin: pg.Client;
  let open: pg.Client[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
  });
  afterEach(async () => {
    const clients = open;
    open = [];
    for (const client of clients) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });

  return {
    async connect() {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      open.push(client);
      const [{ pid }] = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows as [{ pid: number }];
      return {
        pid,
        async query(sql, params) {
          return (await client.query(sql, params)).rows;
        },
      };
    },

    async fixture() {
      const user = randomUUID();
      const restaurant = randomUUID();
      const teams: [string, string] = [randomUUID(), randomUUID()];
      const position = randomUUID();
      const employees: [string, string] = [randomUUID(), randomUUID()];
      const policyVersion = randomUUID();
      const inserts: [string, unknown[]][] = [
        ['BEGIN', []],
        [
          `INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, 'Ana', now())`,
          [user, `${user}@example.com`],
        ],
        [`INSERT INTO restaurants (id, name, updated_at) VALUES ($1, 'Demo', now())`, [restaurant]],
        [
          `INSERT INTO teams (id, restaurant_id, name, updated_at)
           VALUES ($1, $3, 'Salon', now()), ($2, $3, 'Barra', now())`,
          [...teams, restaurant],
        ],
        [
          `INSERT INTO positions (id, restaurant_id, team_id, name, updated_at)
           VALUES ($1, $2, $3, 'Mozo', now())`,
          [position, restaurant, teams[0]],
        ],
        // La versión y sus puestos van en la misma transacción (los puestos solo se aceptan ahí).
        [insertPolicyVersion, [policyVersion, restaurant, 1, 'STANDARD', null, user]],
        [
          `INSERT INTO policy_version_positions (version_id, position_id, portion)
           VALUES ($1, $2, 0.0220000000)`,
          [policyVersion, position],
        ],
        [
          `UPDATE restaurants SET current_policy_version_id = $1 WHERE id = $2`,
          [policyVersion, restaurant],
        ],
        [
          `INSERT INTO employees (id, restaurant_id, first_name, last_name, updated_at)
           VALUES ($1, $3, 'Roro', 'X', now()), ($2, $3, 'Leo', 'Y', now())`,
          [...employees, restaurant],
        ],
        ['COMMIT', []],
      ];
      try {
        for (const [sql, params] of inserts) await admin.query(sql, params);
      } catch (error) {
        await admin.query('ROLLBACK');
        throw error;
      }
      return { restaurant, user, position, policyVersion, employees, teams };
    },

    async waitUntilBlocked(pid) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const { rows } = await admin.query<{ wait: string | null }>(
          'SELECT wait_event_type AS wait FROM pg_stat_activity WHERE pid = $1',
          [pid],
        );
        if (rows[0]?.wait === 'Lock') return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Backend ${pid} never blocked on a lock`);
    },
  };
}

/** Captura el error de una promesa (o null si se resolvió). */
export async function errorOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ───────────────────────── Constructores de filas ─────────────────────────

/**
 * Versión de la política con los valores de la configuración estándar. Parámetros:
 * $1 id, $2 restaurante, $3 número, $4 origen, $5 versión anterior, $6 usuario.
 */
export const insertPolicyVersion = `INSERT INTO distribution_policy_versions (id, restaurant_id,
    number, origin, template_code, template_version, previous_version_id, summary, period_kind,
    period_start_weekday, split_timing, hours_basis, hours_entry, pot_sources, pool_structure,
    portion_mode, rounding_unit, advance_deduction, envelope_handlers, created_by)
  VALUES ($1, $2, $3::int, $4::policy_origin,
    CASE WHEN $4 = 'STANDARD' THEN 'gutip-standard' END, CASE WHEN $4 = 'STANDARD' THEN 1 END,
    $5, 'Versión ' || $3::text, 'WEEKLY', 1, 'PER_PERIOD', 'PERIOD_TOTAL', 'PERIOD_TOTAL_AT_CLOSE',
    'SINGLE_DAILY_AMOUNT', 'SINGLE_POOL', 'BY_POSITION', 'CENT', 'WHOLE_PERIOD', 'MANAGER_ONLY', $6)`;

/** Período (semana) abierto, fijado a la versión `version` (por defecto la del fixture). */
export async function openSettlement(
  s: Session,
  f: Fixture,
  opts: { version?: string; revision?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await s.query(
    `INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, revision,
       policy_version_id, created_by, updated_at)
     VALUES ($1, $2, '2026-09-21', '2026-09-27', $3, $4, $5, now())`,
    [id, f.restaurant, opts.revision ?? 1, opts.version ?? f.policyVersion, f.user],
  );
  return id;
}

/** Distribución DRAFT de un día con una propina y un ítem por empleado. Devuelve los ids. */
export async function draftDay(
  s: Session,
  f: Fixture,
  date: string,
  amountsCents: [number, number],
): Promise<{ distribution: string; items: [string, string] }> {
  const distribution = randomUUID();
  const items: [string, string] = [randomUUID(), randomUUID()];
  const total = amountsCents[0] + amountsCents[1];
  await s.query(
    `INSERT INTO daily_distributions (id, restaurant_id, scope, date_from, date_to, created_by, updated_at)
     VALUES ($1, $2, 'DAY', $3, $3, $4, now())`,
    [distribution, f.restaurant, date, f.user],
  );
  await s.query(
    `INSERT INTO tip_entries (id, daily_distribution_id, entry_date, currency, amount_cents, amount_ars_cents, updated_at)
     VALUES ($1, $2, $3, 'ARS', $4, $4, now())`,
    [randomUUID(), distribution, date, total],
  );
  for (const i of [0, 1] as const) {
    await s.query(
      `INSERT INTO daily_distribution_items (id, daily_distribution_id, employee_id, position_id,
         employee_name_snapshot, position_name_snapshot, team_name_snapshot, portion_snapshot, hours,
         points, percentage, amount_cents, advances_cents, final_cents)
       VALUES ($1, $2, $3, $4, 'Emp', 'Mozo', 'Salon', 0.022, 8, 0.176, 0.5, $5, 0, $5)`,
      [items[i], distribution, f.employees[i], f.position, amountsCents[i]],
    );
  }
  return { distribution, items };
}

export async function advance(
  s: Session,
  f: Fixture,
  opts: { employee: string; date: string; amountCents: number },
): Promise<string> {
  const id = randomUUID();
  await s.query(
    `INSERT INTO advances (id, restaurant_id, employee_id, date, amount_cents, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, f.restaurant, opts.employee, opts.date, opts.amountCents, f.user],
  );
  return id;
}
