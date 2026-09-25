import { describe, expect, it } from 'vitest';
import { ID, closedDay, draftDay, useDatabase, uuid } from './helpers';

const db = useDatabase();

describe('schema: tipos y decisiones de DATABASE.md §1–§2', () => {
  it('todo importe (*_cents) es BIGINT: el dinero nunca es decimal ni flotante', async () => {
    const columns = await db.rows<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%\\_cents' ORDER BY 1, 2`,
    );
    expect(columns.length).toBeGreaterThanOrEqual(20); // que la consulta no sea vacía
    expect(columns.filter((c) => c.data_type !== 'bigint')).toEqual([]);
  });

  it('no existe ninguna columna REAL ni DOUBLE PRECISION en todo el esquema', async () => {
    const floats = await db.rows(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('real', 'double precision')`,
    );
    expect(floats).toEqual([]);
  });

  it.each([
    ['positions', 'weight', 6, 2],
    ['daily_distribution_items', 'weight_snapshot', 6, 2],
    ['daily_distribution_items', 'hours', 6, 2],
    ['daily_distribution_items', 'points', 12, 4],
    ['daily_distribution_items', 'percentage', 9, 6],
    ['daily_distributions', 'total_points', 12, 4],
    ['exchange_rates', 'rate', 18, 6],
    ['tip_entries', 'exchange_rate', 18, 6],
  ])('%s.%s es NUMERIC(%i,%i) exacto', async (table, column, precision, scale) => {
    const [col] = await db.rows<{
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      `SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
    );
    expect(col).toEqual({
      data_type: 'numeric',
      numeric_precision: precision,
      numeric_scale: scale,
    });
  });

  it.each([
    ['daily_distributions', 'date'],
    ['exchange_rates', 'date'],
    ['tip_entries', 'exchange_rate_date'],
    ['advances', 'date'],
    ['weekly_settlements', 'week_start'],
    ['weekly_settlements', 'week_end'],
    ['weekly_payments', 'period_start'],
    ['weekly_payments', 'period_end'],
  ])('%s.%s es DATE (fecha de negocio sin hora)', async (table, column) => {
    const [col] = await db.rows<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
    );
    expect(col?.data_type).toBe('date');
  });

  it('restaurants.pool_mode es obligatorio y NO tiene valor por defecto', async () => {
    const [col] = await db.rows<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurants' AND column_name = 'pool_mode'`,
    );
    expect(col).toEqual({ is_nullable: 'NO', column_default: null });
    await db.fails(
      `INSERT INTO restaurants (id, name, updated_at) VALUES ('${uuid(900)}', 'Sin modo', now());`,
      /null value in column "pool_mode"/,
    );
  });

  it('las enumeraciones tienen exactamente los valores de DATABASE.md §2', async () => {
    const rows = await db.rows<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       GROUP BY t.typname ORDER BY t.typname`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.typname, r.labels]))).toEqual({
      advance_status: ['PENDING', 'APPLIED', 'VOIDED'],
      auth_token_type: ['EMAIL_VERIFICATION', 'PASSWORD_RESET'],
      currency: ['ARS', 'USD'],
      daily_distribution_status: ['DRAFT', 'CLOSED', 'VOIDED'],
      membership_role: ['OWNER', 'ADMIN', 'MANAGER', 'VIEWER'],
      payment_event_type: [
        'CREATED',
        'PREPARED',
        'PREPARATION_UNDONE',
        'DELIVERED',
        'DELIVERY_REVERTED',
        'VOIDED',
      ],
      payment_status: ['PENDING', 'PREPARED', 'DELIVERED', 'VOIDED'],
      rate_source: ['MANUAL', 'API'],
      settlement_status: ['OPEN', 'CLOSED', 'VOIDED'],
      tip_pool_mode: ['SINGLE', 'PER_TEAM'],
    });
  });

  it('el SQL de restricciones creó todos los triggers esperados', async () => {
    const rows = await db.rows<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
    );
    expect(rows.map((r) => r.tgname)).toEqual([
      'trg_advance_applications_guard',
      'trg_advances_guard',
      'trg_advances_no_truncate',
      'trg_audit_log_append_only',
      'trg_audit_log_no_truncate',
      'trg_daily_distribution_items_require_draft',
      'trg_daily_distributions_guard',
      'trg_daily_distributions_no_mixed_modes',
      'trg_tip_entries_require_draft',
      'trg_weekly_payment_events_append_only',
      'trg_weekly_payment_events_no_truncate',
      'trg_weekly_payments_guard',
      'trg_weekly_settlements_guard',
    ]);
  });

  it('los índices únicos parciales y por expresión existen', async () => {
    const rows = await db.rows<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('ux_daily_distributions_active', 'ux_weekly_settlements_active')
       ORDER BY indexname`,
    );
    expect(rows).toHaveLength(2);
    const [daily, weekly] = rows;
    expect(daily?.indexdef).toMatch(/UNIQUE/);
    expect(daily?.indexdef).toMatch(/COALESCE/);
    expect(daily?.indexdef).toMatch(/WHERE/);
    expect(weekly?.indexdef).toMatch(/UNIQUE/);
    expect(weekly?.indexdef).toMatch(/WHERE/);
  });
});

describe('relaciones (claves foráneas)', () => {
  it('todas las FK son ON DELETE RESTRICT, salvo auth_tokens -> users (CASCADE)', async () => {
    const fks = await db.rows<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY conname`,
    );
    expect(fks.length).toBeGreaterThanOrEqual(40); // que la consulta no sea vacía
    const notRestrict = fks.filter((fk) => fk.confdeltype !== 'r').map((fk) => fk.conname);
    expect(notRestrict).toEqual(['auth_tokens_user_id_fkey']);
  });

  it('rechaza referencias a filas inexistentes', async () => {
    await db.fails(
      `INSERT INTO teams (restaurant_id, name, updated_at) VALUES ('${uuid(999)}', 'X', now());`,
      /foreign key constraint/,
    );
    await db.fails(
      `INSERT INTO advances (restaurant_id, employee_id, date, amount_cents, created_by, updated_at)
       VALUES ('${ID.R1}', '${uuid(999)}', '2026-09-20', 500, '${ID.U1}', now());`,
      /foreign key constraint/,
    );
    await db.fails(
      `INSERT INTO daily_distributions (restaurant_id, date, pool_mode, created_by, updated_at)
       VALUES ('${ID.R1}', '2026-09-21', 'SINGLE', '${uuid(999)}', now());`,
      /foreign key constraint/,
    );
  });

  it('no permite borrar un padre referenciado', async () => {
    await db.exec(
      `INSERT INTO memberships (user_id, restaurant_id, role, updated_at) VALUES ('${ID.U1}', '${ID.R1}', 'OWNER', now());`,
    );
    await db.fails(`DELETE FROM users WHERE id = '${ID.U1}';`, /foreign key constraint/);
    await db.fails(`DELETE FROM restaurants WHERE id = '${ID.R1}';`, /foreign key constraint/);
    // el equipo T1 tiene un puesto
    await db.fails(`DELETE FROM teams WHERE id = '${ID.T1}';`, /foreign key constraint/);
  });

  it('no permite borrar empleados ni puestos que ya forman parte del historial', async () => {
    await db.exec(draftDay(100, '2026-09-21'));
    await db.fails(`DELETE FROM employees WHERE id = '${ID.E1}';`, /foreign key constraint/);
    await db.fails(`DELETE FROM positions WHERE id = '${ID.P1}';`, /foreign key constraint/);
  });

  it('no permite borrar una liquidación con distribuciones asignadas (FK), aparte del trigger', async () => {
    await db.exec(
      closedDay(200, '2026-09-21') +
        `INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, created_by, updated_at)
         VALUES ('${uuid(300)}', '${ID.R1}', '2026-09-21', '2026-09-27', '${ID.U1}', now());
         UPDATE daily_distributions SET settlement_id = '${uuid(300)}' WHERE id = '${uuid(200)}';`,
    );
    await db.fails(
      `DELETE FROM weekly_settlements WHERE id = '${uuid(300)}';`,
      /cannot be deleted/,
    );
  });

  it('borrar un usuario elimina sus tokens de email/contraseña (CASCADE)', async () => {
    await db.exec(
      `INSERT INTO users (id, email, name, updated_at) VALUES ('${uuid(50)}', 'tmp@example.com', 'Tmp', now());
       INSERT INTO auth_tokens (user_id, type, token_hash, expires_at)
         VALUES ('${uuid(50)}', 'PASSWORD_RESET', 'hash', now() + interval '1 hour');
       DELETE FROM users WHERE id = '${uuid(50)}';`,
    );
    const rows = await db.rows<{ count: number }>(
      `SELECT count(*)::int AS count FROM auth_tokens WHERE user_id = '${uuid(50)}'`,
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('rechaza un tipo de token inválido', async () => {
    await db.fails(
      `INSERT INTO auth_tokens (user_id, type, token_hash, expires_at)
       VALUES ('${ID.U1}', 'MAGIC_LINK', 'hash', now());`,
      /invalid input value for enum/,
    );
  });
});
