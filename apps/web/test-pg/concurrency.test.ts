import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type Session, advance, draftDay, errorOf, usePg } from './helpers';

const pg = usePg();

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
  const insertDay = `INSERT INTO daily_distributions (id, restaurant_id, date, pool_mode, team_id, created_by, updated_at)
    VALUES ($1, $2, '2026-09-22', $3, $4, $5, now())`;

  it('dos pozos únicos del mismo día creados a la vez: el segundo espera y falla', async () => {
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertDay, [randomUUID(), f.restaurant, 'SINGLE', null, f.user]);
    const second = errorOf(
      t2.query(insertDay, [randomUUID(), f.restaurant, 'SINGLE', null, f.user]),
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
    await t1.query(insertDay, [randomUUID(), f.restaurant, 'SINGLE', null, f.user]);
    const second = errorOf(
      t2.query(insertDay, [randomUUID(), f.restaurant, 'SINGLE', null, f.user]),
    );
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('ROLLBACK');
    expect(await second).toBeNull();
    await t2.query('COMMIT');
  });

  it('dos liquidaciones de la misma semana creadas a la vez: el segundo espera y falla', async () => {
    const f = await pg.fixture();
    // Revisiones distintas: así choca el índice de "una vigente por semana" y no el de revisión.
    const insertWeek = `INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, revision, created_by, updated_at)
      VALUES ($1, $2, '2026-09-21', '2026-09-27', $4, $3, now())`;
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertWeek, [randomUUID(), f.restaurant, f.user, 1]);
    const second = errorOf(t2.query(insertWeek, [randomUUID(), f.restaurant, f.user, 2]));
    await pg.waitUntilBlocked(t2.pid);
    await t1.query('COMMIT');
    expect(await second).toMatch(/ux_weekly_settlements_active/);
  });

  it('documenta el límite del trigger anti-mezcla: SINGLE y PER_TEAM simultáneos pasan los dos', async () => {
    // El trigger trg_daily_distributions_no_mixed_modes no ve filas sin confirmar y los índices
    // no chocan (team_id distinto). Por eso el servicio debe validar la mezcla dentro de su
    // transacción, serializando por restaurante y día (DATABASE.md §10).
    const f = await pg.fixture();
    const t1 = await pg.connect();
    const t2 = await pg.connect();
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await t1.query(insertDay, [randomUUID(), f.restaurant, 'SINGLE', null, f.user]);
    await t2.query(insertDay, [randomUUID(), f.restaurant, 'PER_TEAM', f.teams[0], f.user]);
    await t1.query('COMMIT');
    await t2.query('COMMIT');

    const setup = await pg.connect();
    const modes = await setup.query<{ mode: string }>(
      `SELECT pool_mode::text AS mode FROM daily_distributions
       WHERE restaurant_id = $1 AND date = '2026-09-22' ORDER BY 1`,
      [f.restaurant],
    );
    expect(modes).toEqual([{ mode: 'PER_TEAM' }, { mode: 'SINGLE' }]);
  });
});
