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
  /** Dos empleados del restaurante. */
  employees: [string, string];
}

export interface Pg {
  /** Abre una conexión nueva (se cierra al terminar el test, con ROLLBACK si quedó abierta). */
  connect(): Promise<Session>;
  /** Restaurante nuevo con un equipo, un puesto y dos empleados. */
  fixture(poolMode?: 'SINGLE' | 'PER_TEAM'): Promise<Fixture & { teams: [string, string] }>;
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

    async fixture(poolMode = 'SINGLE') {
      const user = randomUUID();
      const restaurant = randomUUID();
      const teams: [string, string] = [randomUUID(), randomUUID()];
      const position = randomUUID();
      const employees: [string, string] = [randomUUID(), randomUUID()];
      const inserts: [string, unknown[]][] = [
        [
          `INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, 'Ana', now())`,
          [user, `${user}@example.com`],
        ],
        [
          `INSERT INTO restaurants (id, name, pool_mode, updated_at) VALUES ($1, 'Demo', $2, now())`,
          [restaurant, poolMode],
        ],
        [
          `INSERT INTO teams (id, restaurant_id, name, updated_at)
           VALUES ($1, $3, 'Salon', now()), ($2, $3, 'Barra', now())`,
          [...teams, restaurant],
        ],
        [
          `INSERT INTO positions (id, restaurant_id, team_id, name, weight, updated_at)
           VALUES ($1, $2, $3, 'Mozo', 1.00, now())`,
          [position, restaurant, teams[0]],
        ],
        [
          `INSERT INTO employees (id, restaurant_id, first_name, last_name, updated_at)
           VALUES ($1, $3, 'Roro', 'X', now()), ($2, $3, 'Leo', 'Y', now())`,
          [...employees, restaurant],
        ],
      ];
      for (const [sql, params] of inserts) await admin.query(sql, params);
      return { restaurant, user, position, employees, teams };
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

/** Distribución DRAFT de pozo único con una propina y un ítem por empleado. Devuelve los ids. */
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
    `INSERT INTO daily_distributions (id, restaurant_id, date, pool_mode, created_by, updated_at)
     VALUES ($1, $2, $3, 'SINGLE', $4, now())`,
    [distribution, f.restaurant, date, f.user],
  );
  await s.query(
    `INSERT INTO tip_entries (id, daily_distribution_id, currency, amount_cents, amount_ars_cents, updated_at)
     VALUES ($1, $2, 'ARS', $3, $3, now())`,
    [randomUUID(), distribution, total],
  );
  for (const i of [0, 1] as const) {
    await s.query(
      `INSERT INTO daily_distribution_items (id, daily_distribution_id, employee_id, position_id,
         employee_name_snapshot, position_name_snapshot, team_name_snapshot, weight_snapshot, hours,
         points, percentage, amount_cents, advances_cents, final_cents)
       VALUES ($1, $2, $3, $4, 'Emp', 'Mozo', 'Salon', 1.00, 8, 8, 0.5, $5, 0, $5)`,
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
