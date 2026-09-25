import { describe, expect, it } from 'vitest';
import {
  ID,
  advance,
  application,
  closeDistribution,
  closedDay,
  dist,
  draftDay,
  item,
  useDatabase,
  uuid,
  voidDistribution,
} from './helpers';

const db = useDatabase();

const ADVANCE = uuid(150);
const APPLICATION = uuid(160);
const DIST = uuid(100);
const ITEM_A = uuid(102); // ítem de E1 en draftDay(100)/closedDay(100)

describe('adelantos: CHECK', () => {
  it('el monto debe ser positivo', async () => {
    await db.fails(advance(ADVANCE, { amount: 0 }), /ck_advances_amount_positive/);
    await db.fails(advance(ADVANCE, { amount: -10 }), /ck_advances_amount_positive/);
  });

  it('lo aplicado no puede superar el monto ni ser negativo', async () => {
    await db.fails(advance(ADVANCE, { amount: 500, applied: 600 }), /ck_advances_applied_range/);
    await db.fails(advance(ADVANCE, { amount: 500, applied: -1 }), /ck_advances_applied_range/);
  });

  it('el estado coincide con el saldo: APPLIED solo si está totalmente aplicado', async () => {
    await db.fails(
      advance(ADVANCE, { amount: 500, applied: 100, status: 'APPLIED' }),
      /ck_advances_status_matches_balance/,
    );
    await db.fails(
      advance(ADVANCE, { amount: 500, applied: 500, status: 'PENDING' }),
      /ck_advances_status_matches_balance/,
    );
  });

  it('acepta los estados coherentes: PENDING sin aplicar, PENDING parcial, APPLIED y VOIDED', async () => {
    await db.exec(
      advance(uuid(151), { amount: 500, applied: 0, status: 'PENDING' }) +
        advance(uuid(152), { amount: 500, applied: 300, status: 'PENDING' }) + // saldo pendiente 200
        advance(uuid(153), { amount: 500, applied: 500, status: 'APPLIED' }) +
        advance(uuid(154), { amount: 500, applied: 100, status: 'VOIDED' }),
    );
  });

  it('un adelanto superior al importe del día queda con saldo pendiente (ej. $40.000 vs $30.000)', async () => {
    // Datos de prueba de la regla de DATABASE.md §4.4: aplicado 30.000, saldo 10.000, sigue PENDING.
    await db.exec(advance(ADVANCE, { amount: 4_000_000, applied: 3_000_000, status: 'PENDING' }));
    const [row] = await db.rows<{ pending: string; status: string }>(
      `SELECT (amount_cents - applied_cents)::text AS pending, status::text AS status FROM advances WHERE id = '${ADVANCE}'`,
    );
    expect(row).toEqual({ pending: '1000000', status: 'PENDING' });
  });
});

describe('aplicaciones de adelantos (advance_applications)', () => {
  const draftWithAdvance = advance(ADVANCE, { amount: 500 }) + draftDay(100, '2026-09-22');

  it('se crean mientras la distribución es DRAFT (durante el cierre)', async () => {
    await db.exec(draftWithAdvance + application(APPLICATION, ADVANCE, ITEM_A, 500));
  });

  it('una aplicación no puede ser negativa ni cero', async () => {
    await db.exec(draftWithAdvance);
    await db.fails(
      application(APPLICATION, ADVANCE, ITEM_A, 0),
      /ck_advance_applications_amount_positive/,
    );
    await db.fails(
      application(APPLICATION, ADVANCE, ITEM_A, -5),
      /ck_advance_applications_amount_positive/,
    );
  });

  it('un adelanto no se aplica dos veces al mismo ítem', async () => {
    await db.exec(draftWithAdvance + application(APPLICATION, ADVANCE, ITEM_A, 200));
    await db.fails(
      application(uuid(161), ADVANCE, ITEM_A, 100),
      /advance_applications_advance_id_daily_distribution_item_id_key/,
    );
  });

  it('no se puede aplicar un adelanto a una distribución CLOSED', async () => {
    await db.exec(advance(ADVANCE) + closedDay(100, '2026-09-22'));
    await db.fails(
      application(APPLICATION, ADVANCE, ITEM_A),
      /advances can only be applied while the daily distribution is being closed/,
    );
  });

  it('no se puede aplicar un adelanto a una distribución VOIDED', async () => {
    await db.exec(advance(ADVANCE) + closedDay(100, '2026-09-22') + voidDistribution(DIST));
    await db.fails(application(APPLICATION, ADVANCE, ITEM_A), /advances can only be applied/);
  });

  it('una aplicación nace activa (reverted_at NULL)', async () => {
    await db.exec(draftWithAdvance);
    await db.fails(
      `INSERT INTO advance_applications (advance_id, daily_distribution_item_id, amount_cents, reverted_at)
       VALUES ('${ADVANCE}', '${ITEM_A}', 100, now());`,
      /must be created active/,
    );
  });

  describe('una vez cerrada la distribución', () => {
    const closedWithApplication =
      draftWithAdvance +
      application(APPLICATION, ADVANCE, ITEM_A, 500) +
      `UPDATE advances SET applied_cents = 500, status = 'APPLIED' WHERE id = '${ADVANCE}';` +
      closeDistribution(DIST, { total: 2000 });

    it('no se puede modificar el monto ni reasignar la aplicación', async () => {
      await db.exec(closedWithApplication);
      await db.fails(
        `UPDATE advance_applications SET amount_cents = 1 WHERE id = '${APPLICATION}';`,
        /only reverted_at can change/,
      );
      await db.fails(
        `UPDATE advance_applications SET daily_distribution_item_id = '${uuid(103)}' WHERE id = '${APPLICATION}';`,
        /only reverted_at can change/,
      );
    });

    it('no se puede borrar (se revierte con reverted_at)', async () => {
      await db.exec(closedWithApplication);
      await db.fails(
        `DELETE FROM advance_applications WHERE id = '${APPLICATION}';`,
        /cannot be deleted/,
      );
    });

    it('se puede revertir una sola vez', async () => {
      await db.exec(closedWithApplication);
      await db.exec(
        `UPDATE advance_applications SET reverted_at = now() WHERE id = '${APPLICATION}';`,
      );
      await db.fails(
        `UPDATE advance_applications SET reverted_at = now() + interval '1 day' WHERE id = '${APPLICATION}';`,
        /already reverted/,
      );
      await db.fails(
        `UPDATE advance_applications SET reverted_at = NULL WHERE id = '${APPLICATION}';`,
        /already reverted/,
      );
    });

    it('anular la distribución y reabrir el adelanto (saldo vuelve a PENDING) es consistente', async () => {
      await db.exec(closedWithApplication);
      await db.exec(
        `UPDATE advance_applications SET reverted_at = now() WHERE id = '${APPLICATION}';
         UPDATE advances SET applied_cents = 0, status = 'PENDING' WHERE id = '${ADVANCE}';` +
          voidDistribution(DIST, 'cargué mal las horas'),
      );
      const rows = await db.rows<{ status: string; applied_cents: string }>(
        `SELECT status::text AS status, applied_cents::text AS applied_cents FROM advances WHERE id = '${ADVANCE}'`,
      );
      expect(rows[0]).toEqual({ status: 'PENDING', applied_cents: '0' });
    });
  });

  it('un adelanto con saldo se puede volver a aplicar en una distribución posterior', async () => {
    // Adelanto de 1.500 con 500 ya aplicados (saldo 1.000): el cierre de otro día aplica el resto.
    await db.exec(
      advance(uuid(155), { amount: 1500, applied: 500, status: 'PENDING' }) +
        dist(uuid(200), '2026-09-23') +
        item(uuid(202), uuid(200), ID.E1) +
        application(uuid(162), uuid(155), uuid(202), 1000) +
        `UPDATE advances SET applied_cents = 1500, status = 'APPLIED' WHERE id = '${uuid(155)}';`,
    );
  });
});
