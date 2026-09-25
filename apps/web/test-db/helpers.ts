import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, inject } from 'vitest';

/*
 * Estos tests NO reimplementan reglas de negocio: insertan filas directamente y comprueban
 * que PostgreSQL (CHECK, índices únicos, FKs y triggers reales de 0001_constraints.sql)
 * acepta o rechaza. Los valores de las filas son datos de prueba, no cálculos.
 */

export const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

export const ID = {
  U1: uuid(1),
  U2: uuid(2),
  R1: uuid(10),
  T1: uuid(20),
  T2: uuid(21),
  P1: uuid(30),
  E1: uuid(40),
  E2: uuid(41),
  E3: uuid(42),
} as const;

const CONSTRAINTS_SQL = readFileSync(
  fileURLToPath(new URL('../prisma/sql/0001_constraints.sql', import.meta.url)),
  'utf8',
);

/** Aplica el DDL de Prisma + el SQL de restricciones y carga los datos de referencia. */
async function createDatabase(ddl: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(ddl);
  await db.exec(CONSTRAINTS_SQL);
  await db.exec(`
    INSERT INTO users (id, email, name, updated_at)
      VALUES ('${ID.U1}', 'ana@example.com', 'Ana', now()), ('${ID.U2}', 'beto@example.com', 'Beto', now());
    INSERT INTO restaurants (id, name, pool_mode, updated_at) VALUES ('${ID.R1}', 'Demo', 'SINGLE', now());
    INSERT INTO teams (id, restaurant_id, name, updated_at)
      VALUES ('${ID.T1}', '${ID.R1}', 'Salon', now()), ('${ID.T2}', '${ID.R1}', 'Barra', now());
    INSERT INTO positions (id, restaurant_id, team_id, name, weight, updated_at)
      VALUES ('${ID.P1}', '${ID.R1}', '${ID.T1}', 'Mozo', 1.00, now());
    INSERT INTO employees (id, restaurant_id, first_name, last_name, updated_at)
      VALUES ('${ID.E1}', '${ID.R1}', 'Roro', 'X', now()),
             ('${ID.E2}', '${ID.R1}', 'Leo', 'Y', now()),
             ('${ID.E3}', '${ID.R1}', 'Marcos', 'Z', now());
  `);
  return db;
}

export interface Database {
  /** Ejecuta SQL; si falla, el test falla con el error de PostgreSQL. */
  exec(sql: string): Promise<void>;
  rows<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Comprueba que PostgreSQL RECHAZA el SQL con un mensaje que cumple `pattern`. */
  fails(sql: string, pattern: RegExp): Promise<void>;
}

/**
 * Registra los hooks: una base PGlite por archivo de test y una transacción por test que se
 * revierte al final (cada test parte de los mismos datos de referencia, sin depender de otros).
 */
export function useDatabase(): Database {
  let db: PGlite;

  beforeAll(async () => {
    db = await createDatabase(inject('ddl'));
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec('BEGIN');
  });
  afterEach(async () => {
    await db.exec('ROLLBACK');
  });

  return {
    async exec(sql) {
      await db.exec(sql);
    },
    async rows<T>(sql: string) {
      return (await db.query<T>(sql)).rows;
    },
    async fails(sql, pattern) {
      await db.exec('SAVEPOINT expect_failure');
      let message: string | null = null;
      try {
        await db.exec(sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      await db.exec('ROLLBACK TO SAVEPOINT expect_failure');
      if (message === null) {
        throw new Error(
          `Expected PostgreSQL to reject the statement (${pattern}), but it succeeded`,
        );
      }
      if (!pattern.test(message)) {
        throw new Error(`Expected error matching ${pattern}, got: ${message}`);
      }
    },
  };
}

// ───────────────────────── Constructores de filas ─────────────────────────

const lit = (value: string | null): string => (value === null ? 'NULL' : `'${value}'`);

export function dist(
  id: string,
  date: string,
  opts: { mode?: 'SINGLE' | 'PER_TEAM'; team?: string | null } = {},
): string {
  const { mode = 'SINGLE', team = null } = opts;
  return `INSERT INTO daily_distributions (id, restaurant_id, date, pool_mode, team_id, created_by, updated_at)
    VALUES ('${id}', '${ID.R1}', '${date}', '${mode}', ${lit(team)}, '${ID.U1}', now());`;
}

export function tip(
  id: string,
  distributionId: string,
  currency: 'ARS' | 'USD',
  amountCents: number,
  rate: string | null,
  amountArsCents: number,
): string {
  return `INSERT INTO tip_entries (id, daily_distribution_id, currency, amount_cents, exchange_rate, amount_ars_cents, updated_at)
    VALUES ('${id}', '${distributionId}', '${currency}', ${amountCents}, ${rate ?? 'NULL'}, ${amountArsCents}, now());`;
}

export function item(
  id: string,
  distributionId: string,
  employeeId: string,
  opts: {
    amount?: number;
    advances?: number;
    final?: number;
    hours?: string;
    weight?: string;
    percentage?: string;
  } = {},
): string {
  const { amount = 1000, advances = 0, hours = '8', weight = '1.00', percentage = '0.5' } = opts;
  const final = opts.final ?? amount - advances;
  return `INSERT INTO daily_distribution_items (id, daily_distribution_id, employee_id, position_id,
      employee_name_snapshot, position_name_snapshot, team_name_snapshot, weight_snapshot, hours, points,
      percentage, amount_cents, advances_cents, final_cents)
    VALUES ('${id}', '${distributionId}', '${employeeId}', '${ID.P1}', 'Emp', 'Mozo', 'Salon', ${weight}, ${hours},
      8.0000, ${percentage}, ${amount}, ${advances}, ${final});`;
}

export function closeDistribution(
  id: string,
  opts: { total?: number; advances?: number } = {},
): string {
  const { total = 2000, advances = 0 } = opts;
  return `UPDATE daily_distributions SET status = 'CLOSED', closed_at = now(), closed_by = '${ID.U1}',
      tips_ars_cents = ${total}, total_cents = ${total}, total_points = 16,
      total_advances_cents = ${advances}, total_final_cents = ${total - advances}
    WHERE id = '${id}';`;
}

export function voidDistribution(id: string, reason = 'entered by mistake'): string {
  return `UPDATE daily_distributions SET status = 'VOIDED', voided_at = now(), voided_by = '${ID.U1}',
      void_reason = '${reason}' WHERE id = '${id}';`;
}

/** Distribución DRAFT con una propina en ARS y dos ítems (ids base, base+1, base+2, base+3). */
export function draftDay(base: number, date: string): string {
  return (
    dist(uuid(base), date) +
    tip(uuid(base + 1), uuid(base), 'ARS', 2000, null, 2000) +
    item(uuid(base + 2), uuid(base), ID.E1) +
    item(uuid(base + 3), uuid(base), ID.E2)
  );
}

/** Igual que draftDay pero ya cerrada. */
export function closedDay(base: number, date: string): string {
  return draftDay(base, date) + closeDistribution(uuid(base));
}

export function advance(
  id: string,
  opts: {
    employee?: string;
    date?: string;
    amount?: number;
    applied?: number;
    status?: 'PENDING' | 'APPLIED' | 'VOIDED';
  } = {},
): string {
  const {
    employee = ID.E1,
    date = '2026-09-20',
    amount = 500,
    applied = 0,
    status = 'PENDING',
  } = opts;
  return `INSERT INTO advances (id, restaurant_id, employee_id, date, amount_cents, applied_cents, status, created_by, updated_at)
    VALUES ('${id}', '${ID.R1}', '${employee}', '${date}', ${amount}, ${applied}, '${status}', '${ID.U1}', now());`;
}

export function application(
  id: string,
  advanceId: string,
  itemId: string,
  amountCents = 500,
): string {
  return `INSERT INTO advance_applications (id, advance_id, daily_distribution_item_id, amount_cents)
    VALUES ('${id}', '${advanceId}', '${itemId}', ${amountCents});`;
}

export function settlement(
  id: string,
  opts: {
    start?: string;
    end?: string;
    revision?: number;
    supersedes?: string | null;
  } = {},
): string {
  const { start = '2026-09-21', end = '2026-09-27', revision = 1, supersedes = null } = opts;
  return `INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, revision, supersedes_settlement_id, created_by, updated_at)
    VALUES ('${id}', '${ID.R1}', '${start}', '${end}', ${revision}, ${lit(supersedes)}, '${ID.U1}', now());`;
}

export function closeSettlement(id: string, total = 2000): string {
  return `UPDATE weekly_settlements SET status = 'CLOSED', closed_at = now(), closed_by = '${ID.U1}',
      total_cents = ${total}, total_advances_cents = 0, total_final_cents = ${total} WHERE id = '${id}';`;
}

export function voidSettlement(id: string, reason = 'wrong hours on monday'): string {
  return `UPDATE weekly_settlements SET status = 'VOIDED', voided_at = now(), voided_by = '${ID.U1}',
      void_reason = '${reason}' WHERE id = '${id}';`;
}

export function payment(
  id: string,
  settlementId: string,
  opts: {
    employee?: string;
    gross?: number;
    advances?: number;
    net?: number;
    status?: 'PENDING' | 'PREPARED' | 'DELIVERED' | 'VOIDED';
    supersedes?: string | null;
    previouslyDelivered?: number;
  } = {},
): string {
  const {
    employee = ID.E1,
    gross = 1000,
    advances = 200,
    status = 'PENDING',
    supersedes = null,
    previouslyDelivered = 0,
  } = opts;
  const net = opts.net ?? gross - advances;
  const prepared = status === 'PREPARED' || status === 'DELIVERED';
  const delivered = status === 'DELIVERED';
  return `INSERT INTO weekly_payments (id, restaurant_id, settlement_id, employee_id, employee_name_snapshot,
      period_start, period_end, gross_cents, advances_cents, net_cents, status,
      prepared_at, prepared_by, delivered_at, delivered_by, supersedes_payment_id, previously_delivered_cents, updated_at)
    VALUES ('${id}', '${ID.R1}', '${settlementId}', '${employee}', 'Emp', '2026-09-21', '2026-09-27',
      ${gross}, ${advances}, ${net}, '${status}',
      ${prepared ? 'now()' : 'NULL'}, ${prepared ? lit(ID.U1) : 'NULL'},
      ${delivered ? 'now()' : 'NULL'}, ${delivered ? lit(ID.U1) : 'NULL'},
      ${lit(supersedes)}, ${previouslyDelivered}, now());`;
}

export function markPrepared(id: string): string {
  return `UPDATE weekly_payments SET status = 'PREPARED', prepared_at = now(), prepared_by = '${ID.U1}' WHERE id = '${id}';`;
}

export function markDelivered(id: string): string {
  return `UPDATE weekly_payments SET status = 'DELIVERED', delivered_at = now(), delivered_by = '${ID.U1}' WHERE id = '${id}';`;
}

export function revertDelivery(id: string): string {
  return `UPDATE weekly_payments SET status = 'PREPARED', delivered_at = NULL, delivered_by = NULL WHERE id = '${id}';`;
}

export function event(
  paymentId: string,
  type:
    'CREATED' | 'PREPARED' | 'PREPARATION_UNDONE' | 'DELIVERED' | 'DELIVERY_REVERTED' | 'VOIDED',
  opts: {
    reason?: string | null;
    authorizedBy?: string | null;
    from?: string | null;
    to?: string;
  } = {},
): string {
  const { reason = null, authorizedBy = null, from = null, to = 'PENDING' } = opts;
  return `INSERT INTO weekly_payment_events (restaurant_id, payment_id, event_type, from_status, to_status,
      amount_cents, performed_by, authorized_by, reason)
    VALUES ('${ID.R1}', '${paymentId}', '${type}', ${lit(from)}, '${to}', 800, '${ID.U1}', ${lit(authorizedBy)}, ${lit(reason)});`;
}
