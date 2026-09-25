import { describe, expect, it } from 'vitest';
import {
  ID,
  closeDistribution,
  closedDay,
  dist,
  draftDay,
  item,
  settlement,
  tip,
  useDatabase,
  uuid,
  voidDistribution,
} from './helpers';

const db = useDatabase();

// closedDay(base, date) crea: distribución = uuid(base), propina = base+1, ítems = base+2 y base+3.
const DIST = uuid(100);
const TIP = uuid(101);
const ITEM_A = uuid(102);
const SETTLEMENT = uuid(300);

describe('DRAFT: es editable', () => {
  it('permite editar y borrar propinas, ítems y la distribución completa', async () => {
    await db.exec(
      draftDay(100, '2026-09-21') +
        `UPDATE daily_distribution_items SET hours = 7.5 WHERE id = '${ITEM_A}';
         UPDATE tip_entries SET note = 'editada mientras es DRAFT' WHERE id = '${TIP}';
         UPDATE daily_distributions SET notes = 'nota' WHERE id = '${DIST}';
         DELETE FROM daily_distribution_items WHERE daily_distribution_id = '${DIST}';
         DELETE FROM tip_entries WHERE daily_distribution_id = '${DIST}';
         DELETE FROM daily_distributions WHERE id = '${DIST}';`,
    );
  });

  it('DRAFT -> CLOSED y DRAFT -> VOIDED están permitidos', async () => {
    await db.exec(draftDay(100, '2026-09-21') + closeDistribution(DIST));
    await db.exec(dist(uuid(200), '2026-09-22') + voidDistribution(uuid(200)));
  });
});

describe('CLOSED: es inmutable', () => {
  it('no se puede editar ninguna columna de la distribución', async () => {
    await db.exec(closedDay(100, '2026-09-21'));
    const immutable = /IMMUTABLE: a CLOSED daily distribution cannot be modified/;
    await db.fails(`UPDATE daily_distributions SET notes = 'x' WHERE id = '${DIST}';`, immutable);
    await db.fails(
      `UPDATE daily_distributions SET total_cents = 1, tips_ars_cents = 1, total_final_cents = 1 WHERE id = '${DIST}';`,
      immutable,
    );
    await db.fails(
      `UPDATE daily_distributions SET date = '2026-09-25' WHERE id = '${DIST}';`,
      immutable,
    );
    await db.fails(
      `UPDATE daily_distributions SET pool_mode = 'PER_TEAM', team_id = '${ID.T1}' WHERE id = '${DIST}';`,
      immutable,
    );
    await db.fails(
      `UPDATE daily_distributions SET closed_by = '${ID.U2}' WHERE id = '${DIST}';`,
      immutable,
    );
  });

  it('no se puede borrar', async () => {
    await db.exec(closedDay(100, '2026-09-21'));
    await db.fails(
      `DELETE FROM daily_distributions WHERE id = '${DIST}';`,
      /only DRAFT daily distributions can be deleted/,
    );
  });

  it('no se puede volver a DRAFT ni cambiar de estado arbitrariamente', async () => {
    await db.exec(closedDay(100, '2026-09-21'));
    await db.fails(
      `UPDATE daily_distributions SET status = 'DRAFT' WHERE id = '${DIST}';`,
      /INVALID_TRANSITION/,
    );
  });

  it('no se pueden editar, agregar ni borrar ítems', async () => {
    await db.exec(closedDay(100, '2026-09-21'));
    await db.fails(
      `UPDATE daily_distribution_items SET hours = 9 WHERE id = '${ITEM_A}';`,
      /IMMUTABLE/,
    );
    await db.fails(
      `UPDATE daily_distribution_items SET amount_cents = 5, final_cents = 5 WHERE id = '${ITEM_A}';`,
      /IMMUTABLE/,
    );
    await db.fails(item(uuid(150), DIST, ID.E3), /IMMUTABLE/);
    await db.fails(`DELETE FROM daily_distribution_items WHERE id = '${ITEM_A}';`, /IMMUTABLE/);
  });

  it('no se pueden editar, agregar ni borrar propinas (incluida la cotización usada)', async () => {
    await db.exec(closedDay(100, '2026-09-21'));
    await db.fails(`UPDATE tip_entries SET note = 'x' WHERE id = '${TIP}';`, /IMMUTABLE/);
    await db.fails(tip(uuid(160), DIST, 'ARS', 100, null, 100), /IMMUTABLE/);
    await db.fails(`DELETE FROM tip_entries WHERE id = '${TIP}';`, /IMMUTABLE/);
  });

  it('no se puede mover un ítem hacia una distribución CLOSED desde una DRAFT', async () => {
    await db.exec(
      closedDay(100, '2026-09-21') +
        dist(uuid(200), '2026-09-22') +
        item(uuid(202), uuid(200), ID.E3),
    );
    await db.fails(
      `UPDATE daily_distribution_items SET daily_distribution_id = '${DIST}' WHERE id = '${uuid(202)}';`,
      /IMMUTABLE/,
    );
  });
});

describe('VOIDED', () => {
  it('CLOSED -> VOIDED es posible con motivo, si no está en una liquidación', async () => {
    await db.exec(
      closedDay(100, '2026-09-21') + voidDistribution(DIST, 'cargué mal las horas del lunes'),
    );
    const [row] = await db.rows<{ status: string; void_reason: string }>(
      `SELECT status::text AS status, void_reason FROM daily_distributions WHERE id = '${DIST}'`,
    );
    expect(row).toEqual({ status: 'VOIDED', void_reason: 'cargué mal las horas del lunes' });
  });

  it('anular no puede cambiar nada más que estado, fecha, usuario y motivo', async () => {
    await db.exec(closedDay(100, '2026-09-21'));
    await db.fails(
      `UPDATE daily_distributions SET status = 'VOIDED', voided_at = now(), voided_by = '${ID.U1}',
         void_reason = 'entered by mistake', total_cents = 1, tips_ars_cents = 1, total_final_cents = 1 WHERE id = '${DIST}';`,
      /IMMUTABLE: voiding a CLOSED distribution cannot change anything else/,
    );
  });

  it('una VOIDED no se puede editar, reabrir, re-anular ni borrar', async () => {
    await db.exec(closedDay(100, '2026-09-21') + voidDistribution(DIST));
    await db.fails(
      `UPDATE daily_distributions SET notes = 'x' WHERE id = '${DIST}';`,
      /IMMUTABLE: a VOIDED/,
    );
    await db.fails(
      `UPDATE daily_distributions SET status = 'CLOSED' WHERE id = '${DIST}';`,
      /IMMUTABLE: a VOIDED/,
    );
    await db.fails(voidDistribution(DIST, 'segundo intento de anular'), /IMMUTABLE: a VOIDED/);
    await db.fails(
      `DELETE FROM daily_distributions WHERE id = '${DIST}';`,
      /only DRAFT daily distributions can be deleted/,
    );
  });

  it('los ítems y propinas de una VOIDED siguen siendo inmutables (el historial se conserva)', async () => {
    await db.exec(closedDay(100, '2026-09-21') + voidDistribution(DIST));
    await db.fails(
      `UPDATE daily_distribution_items SET hours = 9 WHERE id = '${ITEM_A}';`,
      /IMMUTABLE/,
    );
    await db.fails(`DELETE FROM tip_entries WHERE id = '${TIP}';`, /IMMUTABLE/);
    await db.fails(item(uuid(150), DIST, ID.E3), /IMMUTABLE/);
    const rows = await db.rows<{ count: number }>(
      `SELECT count(*)::int AS count FROM daily_distribution_items WHERE daily_distribution_id = '${DIST}'`,
    );
    expect(rows[0]?.count).toBe(2);
  });

  it('después de anular se puede crear otra distribución para el mismo día', async () => {
    await db.exec(closedDay(100, '2026-09-21') + voidDistribution(DIST));
    await db.exec(dist(uuid(200), '2026-09-21'));
  });
});

describe('vínculo con la liquidación semanal', () => {
  const inSettlement =
    closedDay(100, '2026-09-21') +
    settlement(SETTLEMENT) +
    `UPDATE daily_distributions SET settlement_id = '${SETTLEMENT}' WHERE id = '${DIST}';`;

  it('una CLOSED puede asignarse a una liquidación (único cambio permitido) y liberarse', async () => {
    await db.exec(inSettlement);
    await db.exec(`UPDATE daily_distributions SET settlement_id = NULL WHERE id = '${DIST}';`);
    await db.exec(
      `UPDATE daily_distributions SET settlement_id = '${SETTLEMENT}' WHERE id = '${DIST}';`,
    );
  });

  it('con liquidación asignada no se puede anular', async () => {
    await db.exec(inSettlement);
    await db.fails(
      voidDistribution(DIST, 'quiero anularla igual'),
      /belongs to a weekly settlement/,
    );
  });

  it('con liquidación asignada tampoco se puede editar nada más', async () => {
    await db.exec(inSettlement);
    await db.fails(`UPDATE daily_distributions SET notes = 'x' WHERE id = '${DIST}';`, /IMMUTABLE/);
  });

  it('no se puede pasar directamente a otra liquidación sin liberarla antes', async () => {
    await db.exec(inSettlement + settlement(uuid(301), { start: '2026-09-28', end: '2026-10-04' }));
    await db.fails(
      `UPDATE daily_distributions SET settlement_id = '${uuid(301)}' WHERE id = '${DIST}';`,
      /release the distribution from its settlement/,
    );
  });
});

describe('modo de pozo: un día no mezcla SINGLE y PER_TEAM', () => {
  it('rechaza un pozo por equipo en un día con pozo único', async () => {
    await db.exec(dist(DIST, '2026-09-21'));
    await db.fails(
      dist(uuid(200), '2026-09-21', { mode: 'PER_TEAM', team: ID.T1 }),
      /a day cannot mix SINGLE and PER_TEAM/,
    );
  });

  it('rechaza un pozo único en un día con pozos por equipo', async () => {
    await db.exec(dist(DIST, '2026-09-21', { mode: 'PER_TEAM', team: ID.T1 }));
    await db.fails(dist(uuid(200), '2026-09-21'), /a day cannot mix SINGLE and PER_TEAM/);
  });

  it('días distintos pueden usar modos distintos (cambio de modo hacia adelante)', async () => {
    await db.exec(
      dist(DIST, '2026-09-21') + dist(uuid(200), '2026-09-22', { mode: 'PER_TEAM', team: ID.T1 }),
    );
  });

  it('una distribución anulada no cuenta para la mezcla de modos', async () => {
    await db.exec(closedDay(100, '2026-09-21') + voidDistribution(DIST));
    await db.exec(dist(uuid(200), '2026-09-21', { mode: 'PER_TEAM', team: ID.T1 }));
  });
});
