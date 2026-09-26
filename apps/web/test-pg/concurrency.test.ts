import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type Fixture,
  type Session,
  advance,
  draftDay,
  errorOf,
  insertPolicyVersion,
  openSettlement,
  usePg,
} from './helpers';

const pg = usePg();

/** Registro de un cambio automático de versión: $1 restaurante, $2 período, $3 desde, $4 hacia, $5 usuario. */
const logChange = `INSERT INTO period_policy_changes (restaurant_id, settlement_id, from_version_id,
    to_version_id, automatic, performed_by)
  VALUES ($1, $2, $3, $4, true, $5)`;

/** Versión 2 de la política (con su puesto, en la misma transacción) y vigente. */
async function newVersion(s: Session, f: Fixture): Promise<string> {
  const id = randomUUID();
  await s.query('BEGIN');
  await s.query(insertPolicyVersion, [id, f.restaurant, 2, 'CHANGE', f.policyVersion, f.user]);
  await s.query(
    `INSERT INTO policy_version_positions (version_id, position_id, portion) VALUES ($1, $2, 0.0144444444)`,
    [id, f.position],
  );
  await s.query(`UPDATE restaurants SET current_policy_version_id = $1 WHERE id = $2`, [
    id,
    f.restaurant,
  ]);
  await s.query('COMMIT');
  return id;
}

/*
 * Paso 5 del cierre diario (DATABASE.md §6): tomar los adelantos PENDING del empleado con fecha
 * <= día, del más antiguo al más nuevo, y aplicarlos hasta el importe del ítem. El cálculo es
 * trivial a propósito: lo que se prueba es el protocolo de bloqueo, no la aritmética (que es del
 * motor). `lock: false` reproduce un servicio que olvida el FOR UPDATE.
 */
async function applyAdvances(
  s: Session,
  opts: { employee: string; date: string; item: string; itemCents: number; lock: boolean },
): Promise<number> {
  const pending = await s.query<{ id: string; amount: string; applied: string }>(
    `SELECT id, amount_cents::text AS amount, applied_cents::text AS applied
     FROM advances
     WHERE employee_id = $1 AND status = 'PENDING' AND date <= $2
     ORDER BY date, id ${opts.lock ? 'FOR UPDATE' : ''}`,
    [opts.employee, opts.date],
  );
  let available = opts.itemCents;
  let total = 0;
  for (const row of pending) {
    const remaining = Number(row.amount) - Number(row.applied);
    const take = Math.min(remaining, available);
    if (take <= 0) break;
    const applied = Number(row.applied) + take;
    await s.query(
      `INSERT INTO advance_applications (id, advance_id, daily_distribution_item_id, amount_cents)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), row.id, opts.item, take],
    );
    await s.query(
      `UPDATE advances SET applied_cents = $2,
         status = CASE WHEN $2 = amount_cents THEN 'APPLIED'::advance_status ELSE 'PENDING'::advance_status END,
         updated_at = now()
       WHERE id = $1`,
      [row.id, applied],
    );
    available -= take;
    total += take;
  }
  return total;
}

async function advanceState(s: Session, id: string) {
  const [row] = await s.query<{ applied: string; status: string; applications: string }>(
    `SELECT a.applied_cents::text AS applied, a.status::text AS status,
            COALESCE((SELECT SUM(ap.amount_cents) FROM advance_applications ap
                      WHERE ap.advance_id = a.id AND ap.reverted_at IS NULL), 0)::text AS applications
     FROM advances a WHERE a.id = $1`,
    [id],
  );
  return row;
}

describe('I11: un adelanto aplicado desde dos cierres simultáneos nunca supera su monto', () => {
  it('con FOR UPDATE el segundo cierre espera y aplica solo el saldo restante', async () => {
    const f = await pg.fixture();
    const [employee] = f.employees;
    const setup = await pg.connect();
    // Adelanto de $40.000; dos días con $30.000 para el empleado, cerrados a la vez.
    const adv = await advance(setup, f, { employee, date: '2026-09-21', amountCents: 4_000_000 });
    const monday = await draftDay(setup, f, '2026-09-22', [3_000_000, 1_000_000]);
    const tuesday = await draftDay(setup, f, '2026-09-23', [3_000_000, 1_000_000]);

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');

    const first = await applyAdvances(t1, {
      employee,
      date: '2026-09-22',
      item: monday.items[0],
      itemCents: 3_000_000,
      lock: true,
    });
    expect(first).toBe(3_000_000);

    const second = applyAdvances(t2, {
      employee,
      date: '2026-09-23',
      item: tuesday.items[0],
      itemCents: 3_000_000,
      lock: true,
    });
    await pg.waitUntilBlocked(t2.pid); // el FOR UPDATE de t2 espera a t1
    await t1.query('COMMIT');
    expect(await second).toBe(1_000_000); // vio lo aplicado por t1: solo quedaba el saldo
    await t2.query('COMMIT');

    expect(await advanceState(setup, adv)).toEqual({
      applied: '4000000',
      status: 'APPLIED',
      applications: '4000000',
    });
  });

  it('si el primer cierre consume todo el adelanto, el segundo ya no lo encuentra PENDING', async () => {
    const f = await pg.fixture();
    const [employee] = f.employees;
    const setup = await pg.connect();
    const adv = await advance(setup, f, { employee, date: '2026-09-21', amountCents: 3_000_000 });
    const monday = await draftDay(setup, f, '2026-09-22', [3_000_000, 1_000_000]);
    const tuesday = await draftDay(setup, f, '2026-09-23', [3_000_000, 1_000_000]);

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await applyAdvances(t1, {
      employee,
      date: '2026-09-22',
      item: monday.items[0],
      itemCents: 3_000_000,
      lock: true,
    });
    const second = applyAdvances(t2, {
      employee,
      date: '2026-09-23',
      item: tuesday.items[0],
      itemCents: 3_000_000,
      lock: true,
    });
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    // READ COMMITTED: tras la espera, PostgreSQL reevalúa el WHERE sobre la versión confirmada.
    expect(await second).toBe(0);
    await t2.query('COMMIT');

    expect(await advanceState(setup, adv)).toEqual({
      applied: '3000000',
      status: 'APPLIED',
      applications: '3000000',
    });
  });

  it('si el primer cierre se revierte, el segundo aplica el adelanto completo', async () => {
    const f = await pg.fixture();
    const [employee] = f.employees;
    const setup = await pg.connect();
    const adv = await advance(setup, f, { employee, date: '2026-09-21', amountCents: 4_000_000 });
    const monday = await draftDay(setup, f, '2026-09-22', [3_000_000, 1_000_000]);
    const tuesday = await draftDay(setup, f, '2026-09-23', [5_000_000, 1_000_000]);

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await applyAdvances(t1, {
      employee,
      date: '2026-09-22',
      item: monday.items[0],
      itemCents: 3_000_000,
      lock: true,
    });
    const second = applyAdvances(t2, {
      employee,
      date: '2026-09-23',
      item: tuesday.items[0],
      itemCents: 5_000_000,
      lock: true,
    });
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('ROLLBACK');
    expect(await second).toBe(4_000_000);
    await t2.query('COMMIT');

    expect(await advanceState(setup, adv)).toEqual({
      applied: '4000000',
      status: 'APPLIED',
      applications: '4000000',
    });
  });
});

describe('qué garantiza la base sin el FOR UPDATE del servicio', () => {
  it('un incremento relativo (applied + x) lo frena el CHECK: el segundo cierre falla', async () => {
    const f = await pg.fixture();
    const [employee] = f.employees;
    const setup = await pg.connect();
    const adv = await advance(setup, f, { employee, date: '2026-09-21', amountCents: 4_000_000 });

    const increment = `UPDATE advances SET applied_cents = applied_cents + 3000000,
        status = CASE WHEN applied_cents + 3000000 = amount_cents THEN 'APPLIED'::advance_status
                      ELSE 'PENDING'::advance_status END
      WHERE id = $1`;
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(increment, [adv]);
    const second = errorOf(t2.query(increment, [adv]));
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/ck_advances_applied_range/);
  });

  it('documenta el riesgo: leer y escribir un valor absoluto sin bloquear pierde una actualización', async () => {
    // Este es el motivo por el que el servicio DEBE usar FOR UPDATE (DATABASE.md §6, paso 5):
    // la base no puede detectar esta carrera porque cada fila, por separado, es válida.
    const f = await pg.fixture();
    const [employee] = f.employees;
    const setup = await pg.connect();
    const adv = await advance(setup, f, { employee, date: '2026-09-21', amountCents: 4_000_000 });
    const monday = await draftDay(setup, f, '2026-09-22', [3_000_000, 1_000_000]);
    const tuesday = await draftDay(setup, f, '2026-09-23', [3_000_000, 1_000_000]);

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    // Ambos leen applied = 0 antes de que el otro escriba.
    const read = `SELECT applied_cents FROM advances WHERE id = $1`;
    await t1.query(read, [adv]);
    await t2.query(read, [adv]);
    const insert = `INSERT INTO advance_applications (id, advance_id, daily_distribution_item_id, amount_cents)
      VALUES ($1, $2, $3, 3000000)`;
    const write = `UPDATE advances SET applied_cents = 3000000 WHERE id = $1`;
    await t1.query(insert, [randomUUID(), adv, monday.items[0]]);
    await t1.query(write, [adv]);
    await t2.query(insert, [randomUUID(), adv, tuesday.items[0]]);
    const second = t2.query(write, [adv]);
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    await second;
    await t2.query('COMMIT');

    // I4 e I11 rotas: se aplicaron $60.000 de un adelanto de $40.000 y la fila dice $30.000.
    expect(await advanceState(setup, adv)).toEqual({
      applied: '3000000',
      status: 'PENDING',
      applications: '6000000',
    });
  });
});

describe('cierre simultáneo de la misma distribución', () => {
  it('con FOR UPDATE el segundo cierre espera y ve la distribución ya CLOSED', async () => {
    const f = await pg.fixture();
    const setup = await pg.connect();
    const day = await draftDay(setup, f, '2026-09-22', [1_000, 1_000]);
    const lockDay = `SELECT status::text AS status FROM daily_distributions WHERE id = $1 FOR UPDATE`;

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    expect(await t1.query(lockDay, [day.distribution])).toEqual([{ status: 'DRAFT' }]);
    const second = t2.query(lockDay, [day.distribution]);
    await pg.waitUntilBlocked(t2.pid);
    await t1.query(
      `UPDATE daily_distributions SET status = 'CLOSED', closed_at = now(), closed_by = $2,
         tips_ars_cents = 2000, total_cents = 2000, total_points = 16,
         total_advances_cents = 0, total_final_cents = 2000
       WHERE id = $1`,
      [day.distribution, f.user],
    );
    await t1.query('COMMIT');
    // El servicio ve CLOSED y aborta (paso 1 del cierre): no se cierra dos veces.
    expect(await second).toEqual([{ status: 'CLOSED' }]);
  });
});

describe('índices únicos bajo concurrencia', () => {
  const insertDay = `INSERT INTO daily_distributions (id, restaurant_id, scope, date_from, date_to, created_by, updated_at)
    VALUES ($1, $2, $3::distribution_scope, '2026-09-22', $4, $5, now())`;

  it('dos repartos que empiezan el mismo día creados a la vez: el segundo espera y falla', async () => {
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertDay, [randomUUID(), f.restaurant, 'DAY', '2026-09-22', f.user]);
    const second = errorOf(
      t2.query(insertDay, [randomUUID(), f.restaurant, 'PERIOD', '2026-09-28', f.user]),
    );
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/ux_daily_distributions_active/);
  });

  it('si el primero se revierte, el segundo se crea', async () => {
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertDay, [randomUUID(), f.restaurant, 'DAY', '2026-09-22', f.user]);
    const second = errorOf(
      t2.query(insertDay, [randomUUID(), f.restaurant, 'DAY', '2026-09-22', f.user]),
    );
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('ROLLBACK');
    expect(await second).toBeNull();
    await t2.query('COMMIT');
  });

  it('dos liquidaciones de la misma semana creadas a la vez: el segundo espera y falla', async () => {
    const f = await pg.fixture();
    // Revisiones distintas: así choca el índice de "una vigente por semana" y no el de revisión.
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await openSettlement(t1, f, { revision: 1 });
    const second = errorOf(openSettlement(t2, f, { revision: 2 }));
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/ux_weekly_settlements_active/);
  });
});

describe('repartos superpuestos con distinto inicio (trigger fn_daily_distributions_no_overlap)', () => {
  const insertDist = `INSERT INTO daily_distributions (id, restaurant_id, scope, date_from, date_to, created_by, updated_at)
    VALUES ($1, $2, $3::distribution_scope, $4, $5, $6, now())`;
  const lockRestaurant = `SELECT id FROM restaurants WHERE id = $1 FOR UPDATE`;

  it('documenta el límite del trigger: sin serializar, un DAY y un PERIOD simultáneos pasan los dos', async () => {
    // El trigger no ve filas sin confirmar y el índice no choca (date_from distinto). Por eso el
    // servicio crea repartos serializando por restaurante (DATABASE.md §10).
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertDist, [
      randomUUID(),
      f.restaurant,
      'DAY',
      '2026-09-23',
      '2026-09-23',
      f.user,
    ]);
    await t2.query(insertDist, [
      randomUUID(),
      f.restaurant,
      'PERIOD',
      '2026-09-21',
      '2026-09-27',
      f.user,
    ]);
    await t1.query('COMMIT');
    await t2.query('COMMIT');

    const setup = await pg.connect();
    const rows = await setup.query<{ scope: string }>(
      `SELECT scope::text AS scope FROM daily_distributions WHERE restaurant_id = $1 ORDER BY 1`,
      [f.restaurant],
    );
    expect(rows).toEqual([{ scope: 'DAY' }, { scope: 'PERIOD' }]);
  });

  it('serializando por restaurante (FOR UPDATE), el segundo espera y el trigger lo rechaza', async () => {
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(lockRestaurant, [f.restaurant]);
    await t1.query(insertDist, [
      randomUUID(),
      f.restaurant,
      'DAY',
      '2026-09-23',
      '2026-09-23',
      f.user,
    ]);
    const second = errorOf(
      (async () => {
        await t2.query(lockRestaurant, [f.restaurant]);
        await t2.query(insertDist, [
          randomUUID(),
          f.restaurant,
          'PERIOD',
          '2026-09-21',
          '2026-09-27',
          f.user,
        ]);
      })(),
    );
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/distributions of a restaurant cannot overlap/);
  });
});

describe('política versionada bajo concurrencia', () => {
  it('dos versiones nuevas con el mismo número a la vez: la segunda espera y falla', async () => {
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    const change = (id: string) => [id, f.restaurant, 2, 'CHANGE', f.policyVersion, f.user];
    await t1.query(insertPolicyVersion, change(randomUUID()));
    const second = errorOf(t2.query(insertPolicyVersion, change(randomUUID())));
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/distribution_policy_versions_restaurant_id_number_key/);
  });

  it('los puestos de una versión solo se agregan en la transacción que la crea', async () => {
    const f = await pg.fixture();
    const version = randomUUID();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t1.query(insertPolicyVersion, [
      version,
      f.restaurant,
      2,
      'CHANGE',
      f.policyVersion,
      f.user,
    ]);
    await t1.query('COMMIT');
    expect(
      await errorOf(
        t2.query(
          `INSERT INTO policy_version_positions (version_id, position_id, portion) VALUES ($1, $2, 0.03)`,
          [version, f.position],
        ),
      ),
    ).toMatch(/in the transaction that creates it/);
  });

  it('el registro de un cambio de versión no autoriza el cambio desde otra transacción', async () => {
    const f = await pg.fixture();
    const setup = await pg.connect();
    const settlementId = await openSettlement(setup, f);
    const v2 = await newVersion(setup, f);

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t1.query(logChange, [f.restaurant, settlementId, f.policyVersion, v2, f.user]);
    await t1.query('COMMIT');
    expect(
      await errorOf(
        t2.query(`UPDATE weekly_settlements SET policy_version_id = $1 WHERE id = $2`, [
          v2,
          settlementId,
        ]),
      ),
    ).toMatch(/must be recorded in period_policy_changes/);
  });
});

describe('cierre del período vs. cambio de versión de la política', () => {
  const closePeriod = `UPDATE weekly_settlements SET status = 'CLOSED', closed_at = now(), closed_by = $2,
      total_cents = 0, total_advances_cents = 0, total_final_cents = 0,
      policy_snapshot = '{"roundingUnit":"CENT"}', calc_version = 'provisional-1'
    WHERE id = $1`;
  const repin = `UPDATE weekly_settlements SET policy_version_id = $1 WHERE id = $2`;

  it('si el cierre va primero, el cambio de versión espera y después lo rechaza', async () => {
    const f = await pg.fixture();
    const setup = await pg.connect();
    const settlementId = await openSettlement(setup, f);
    const v2 = await newVersion(setup, f);

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(closePeriod, [settlementId, f.user]);
    const second = errorOf(
      (async () => {
        await t2.query(logChange, [f.restaurant, settlementId, f.policyVersion, v2, f.user]);
        await t2.query(repin, [v2, settlementId]);
      })(),
    );
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/only an OPEN period can change its policy version/);

    const rows = await setup.query<{ status: string; version: string; changes: number }>(
      `SELECT status::text AS status, policy_version_id AS version,
              (SELECT count(*)::int FROM period_policy_changes WHERE settlement_id = $1) AS changes
       FROM weekly_settlements WHERE id = $1`,
      [settlementId],
    );
    expect(rows).toEqual([{ status: 'CLOSED', version: f.policyVersion, changes: 0 }]);
  });

  it('si el cambio de versión va primero, el cierre espera y cierra con la versión nueva', async () => {
    const f = await pg.fixture();
    const setup = await pg.connect();
    const settlementId = await openSettlement(setup, f);
    const v2 = await newVersion(setup, f);
    const lockPeriod = `SELECT policy_version_id AS version FROM weekly_settlements WHERE id = $1 FOR UPDATE`;

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(logChange, [f.restaurant, settlementId, f.policyVersion, v2, f.user]);
    await t1.query(repin, [v2, settlementId]);
    // El cierre bloquea el período antes de calcular: así calcula con la versión confirmada.
    const locked = t2.query<{ version: string }>(lockPeriod, [settlementId]);
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await locked).toEqual([{ version: v2 }]);
    await t2.query(closePeriod, [settlementId, f.user]);
    await t2.query('COMMIT');
  });

  it('horas cargadas mientras se cierra: el cierre espera; después las horas se rechazan', async () => {
    const f = await pg.fixture();
    const setup = await pg.connect();
    const settlementId = await openSettlement(setup, f);
    const insertHours = `INSERT INTO period_hours (restaurant_id, settlement_id, employee_id, hours, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())`;

    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertHours, [f.restaurant, settlementId, f.employees[0], 40, f.user]);
    const closing = t2.query(closePeriod, [settlementId, f.user]);
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    await closing;
    await t2.query('COMMIT');

    expect(
      await errorOf(
        setup.query(insertHours, [f.restaurant, settlementId, f.employees[1], 8, f.user]),
      ),
    ).toMatch(/hours of a period can only change while it is OPEN/);
  });
});
