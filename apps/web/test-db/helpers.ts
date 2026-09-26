import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { afterAll, afterEach, beforeAll, beforeEach, inject } from 'vitest';

/*
 * Estos tests NO reimplementan reglas de negocio: insertan filas directamente y comprueban
 * que PostgreSQL (CHECK, índices únicos, FKs y triggers reales de sql/constraints.sql)
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
  /** Versión 1 de la política de R1 (configuración estándar). */
  V1: uuid(50),
} as const;

const CONSTRAINTS_SQL = readFileSync(
  fileURLToPath(new URL('../prisma/sql/constraints.sql', import.meta.url)),
  'utf8',
);

/** Aplica el DDL de Prisma + el SQL de restricciones y carga los datos de referencia. */
async function createDatabase(ddl: string): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(ddl);
  await db.exec(CONSTRAINTS_SQL);
  await db.exec(`
    INSERT INTO users (id, email, name, updated_at)
      VALUES ('${ID.U1}', 'ana@example.com', 'Ana', now()), ('${ID.U2}', 'beto@example.com', 'Beto', now());
    INSERT INTO restaurants (id, name, updated_at) VALUES ('${ID.R1}', 'Demo', now());
    INSERT INTO teams (id, restaurant_id, name, updated_at)
      VALUES ('${ID.T1}', '${ID.R1}', 'Salon', now()), ('${ID.T2}', '${ID.R1}', 'Barra', now());
    INSERT INTO positions (id, restaurant_id, team_id, name, updated_at)
      VALUES ('${ID.P1}', '${ID.R1}', '${ID.T1}', 'Mozo', now());
    ${policyVersion(ID.V1)}
    ${versionPosition(ID.V1)}
    UPDATE restaurants SET current_policy_version_id = '${ID.V1}' WHERE id = '${ID.R1}';
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

/** Reparto de un día (DAY) o de un período entero (PERIOD, `to` = último día). */
export function dist(
  id: string,
  date: string,
  opts: { scope?: 'DAY' | 'PERIOD'; to?: string } = {},
): string {
  const { scope = 'DAY', to = date } = opts;
  return `INSERT INTO daily_distributions (id, restaurant_id, scope, date_from, date_to, created_by, updated_at)
    VALUES ('${id}', '${ID.R1}', '${scope}', '${date}', '${to}', '${ID.U1}', now());`;
}

/** Versión de la política con los valores de la configuración estándar. */
export function policyVersion(
  id: string,
  opts: {
    restaurant?: string;
    number?: number;
    origin?: 'STANDARD' | 'COPY' | 'CHANGE';
    previous?: string | null;
    copiedFrom?: string | null;
    rounding?: 'CENT' | 'PESO';
    weekday?: number;
  } = {},
): string {
  const {
    restaurant = ID.R1,
    number = 1,
    origin = 'STANDARD',
    previous = null,
    copiedFrom = null,
    rounding = 'CENT',
    weekday = 1,
  } = opts;
  const standard = origin === 'STANDARD';
  return `INSERT INTO distribution_policy_versions (id, restaurant_id, number, origin, template_code,
      template_version, previous_version_id, copied_from_version_id, summary, period_kind,
      period_start_weekday, split_timing, hours_basis, hours_entry, pot_sources, pool_structure,
      portion_mode, rounding_unit, advance_deduction, envelope_handlers, created_by)
    VALUES ('${id}', '${restaurant}', ${number}, '${origin}', ${standard ? "'gutip-standard'" : 'NULL'},
      ${standard ? '1' : 'NULL'}, ${lit(previous)}, ${lit(copiedFrom)}, 'Versión ${number}', 'WEEKLY',
      ${weekday}, 'PER_PERIOD', 'PERIOD_TOTAL', 'PERIOD_TOTAL_AT_CLOSE', 'SINGLE_DAILY_AMOUNT',
      'SINGLE_POOL', 'BY_POSITION', '${rounding}', 'WHOLE_PERIOD', 'MANAGER_ONLY', '${ID.U1}');`;
}

/** Puesto de una versión (solo se acepta en la transacción que crea la versión). */
export function versionPosition(
  versionId: string,
  positionId: string = ID.P1,
  portion = '0.0220000000',
): string {
  return `INSERT INTO policy_version_positions (version_id, position_id, portion)
    VALUES ('${versionId}', '${positionId}', ${portion});`;
}

/** Registro del cambio de versión de un período: automático, o explícito con motivo. */
export function policyChange(
  settlementId: string,
  from: string,
  to: string,
  reason: string | null = null,
): string {
  return `INSERT INTO period_policy_changes (restaurant_id, settlement_id, from_version_id, to_version_id,
      automatic, reason, performed_by)
    VALUES ('${ID.R1}', '${settlementId}', '${from}', '${to}', ${reason === null}, ${lit(reason)}, '${ID.U1}');`;
}

/** Horas totales de un empleado en el período. */
export function periodHours(settlementId: string, employee: string, hours: string): string {
  return `INSERT INTO period_hours (restaurant_id, settlement_id, employee_id, hours, updated_by, updated_at)
    VALUES ('${ID.R1}', '${settlementId}', '${employee}', ${hours}, '${ID.U1}', now());`;
}

export function tip(
  id: string,
  distributionId: string,
  currency: 'ARS' | 'USD',
  amountCents: number,
  rate: string | null,
  amountArsCents: number,
  entryDate = '2026-09-21',
): string {
  return `INSERT INTO tip_entries (id, daily_distribution_id, entry_date, currency, amount_cents, exchange_rate, amount_ars_cents, updated_at)
    VALUES ('${id}', '${distributionId}', '${entryDate}', '${currency}', ${amountCents}, ${rate ?? 'NULL'}, ${amountArsCents}, now());`;
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
    portion?: string;
    percentage?: string;
  } = {},
): string {
  const {
    amount = 1000,
    advances = 0,
    hours = '8',
    portion = '0.0220000000',
    percentage = '0.5',
  } = opts;
  const final = opts.final ?? amount - advances;
  return `INSERT INTO daily_distribution_items (id, daily_distribution_id, employee_id, position_id,
      employee_name_snapshot, position_name_snapshot, team_name_snapshot, portion_snapshot, hours, points,
      percentage, amount_cents, advances_cents, final_cents)
    VALUES ('${id}', '${distributionId}', '${employeeId}', '${ID.P1}', 'Emp', 'Mozo', 'Salon', ${portion}, ${hours},
      0.176, ${percentage}, ${amount}, ${advances}, ${final});`;
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
    tip(uuid(base + 1), uuid(base), 'ARS', 2000, null, 2000, date) +
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
  const voided = status === 'VOIDED';
  return `INSERT INTO advances (id, restaurant_id, employee_id, date, amount_cents, applied_cents, status, created_by,
      voided_at, voided_by, void_reason, updated_at)
    VALUES ('${id}', '${ID.R1}', '${employee}', '${date}', ${amount}, ${applied}, '${status}', '${ID.U1}',
      ${voided ? 'now()' : 'NULL'}, ${voided ? lit(ID.U1) : 'NULL'}, ${voided ? "'entered by mistake'" : 'NULL'}, now());`;
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
    version?: string;
  } = {},
): string {
  const {
    start = '2026-09-21',
    end = '2026-09-27',
    revision = 1,
    supersedes = null,
    version = ID.V1,
  } = opts;
  return `INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, revision, supersedes_settlement_id,
      policy_version_id, created_by, updated_at)
    VALUES ('${id}', '${ID.R1}', '${start}', '${end}', ${revision}, ${lit(supersedes)}, '${version}', '${ID.U1}', now());`;
}

/** Cierra el período congelando la configuración usada (snapshot) y la versión del cálculo. */
export function closeSettlement(id: string, total = 2000): string {
  return `UPDATE weekly_settlements SET status = 'CLOSED', closed_at = now(), closed_by = '${ID.U1}',
      total_cents = ${total}, total_advances_cents = 0, total_final_cents = ${total},
      policy_snapshot = '{"roundingUnit":"CENT"}', calc_version = 'provisional-1'
    WHERE id = '${id}';`;
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
