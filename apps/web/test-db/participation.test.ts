import { describe, expect, it } from 'vitest';
import { closeDistribution, dist, ID, policyVersion, tip, useDatabase, uuid } from './helpers';

/*
 * M1 — métodos de participación, puntos individuales y formato de la porción (DATABASE.md rev. 7).
 * La base solo garantiza lo estructural: puntos > 0, snapshot coherente e inmutable. Qué método se
 * usó y con qué valores lo decide el servicio al cerrar.
 */

const db = useDatabase();

/** Ítem con los datos de participación elegidos (porción y/o puntos pueden ser NULL). */
function participationItem(
  id: string,
  distributionId: string,
  employeeId: string,
  portion: string,
  points: string,
): string {
  return `INSERT INTO daily_distribution_items (id, daily_distribution_id, employee_id, position_id,
      employee_name_snapshot, position_name_snapshot, portion_snapshot, individual_points_snapshot,
      hours, points, percentage, amount_cents, advances_cents, final_cents)
    VALUES ('${id}', '${distributionId}', '${employeeId}', '${ID.P1}', 'Emp', 'Mozo', ${portion},
      ${points}, 8, 9.6, 0.5, 1000, 0, 1000);`;
}

describe('participación: valores por defecto', () => {
  it('un restaurante nuevo muestra la porción como decimal', async () => {
    expect(
      await db.rows(`SELECT portion_display::text AS d FROM restaurants WHERE id = '${ID.R1}'`),
    ).toEqual([{ d: 'DECIMAL' }]);
  });

  it('un empleado nuevo tiene 1,00 punto', async () => {
    expect(
      await db.rows(`SELECT individual_points::text AS p FROM employees WHERE id = '${ID.E1}'`),
    ).toEqual([{ p: '1.00' }]);
  });

  it('la política acepta los tres métodos de participación', async () => {
    for (const [n, mode] of [
      [2, 'BY_POINTS'],
      [3, 'BY_POSITION_TIMES_POINTS'],
    ] as const) {
      const id = uuid(900 + n);
      await db.exec(
        policyVersion(id, { number: n, origin: 'CHANGE', previous: ID.V1 }).replace(
          "'BY_POSITION'",
          `'${mode}'`,
        ),
      );
    }
    expect(
      await db.rows(
        `SELECT portion_mode::text AS m FROM distribution_policy_versions
         WHERE restaurant_id = '${ID.R1}' ORDER BY number`,
      ),
    ).toEqual([{ m: 'BY_POSITION' }, { m: 'BY_POINTS' }, { m: 'BY_POSITION_TIMES_POINTS' }]);
  });
});

describe('participación: puntos individuales', () => {
  it.each(['0', '-1', '-0.01'])('rechaza puntos %s', async (points) => {
    await db.fails(
      `UPDATE employees SET individual_points = ${points} WHERE id = '${ID.E1}';`,
      /ck_employees_individual_points/,
    );
  });

  it('acepta 0,01 y 1,20; NUMERIC(6,2) no admite 10.000 (los 2 decimales los valida Zod)', async () => {
    await db.exec(`UPDATE employees SET individual_points = 0.01 WHERE id = '${ID.E1}';`);
    await db.exec(`UPDATE employees SET individual_points = 1.20 WHERE id = '${ID.E2}';`);
    await db.fails(
      `UPDATE employees SET individual_points = 10000 WHERE id = '${ID.E1}';`,
      /numeric field overflow/,
    );
  });

  it('el formato de la porción solo acepta DECIMAL o PERCENT', async () => {
    await db.exec(`UPDATE restaurants SET portion_display = 'PERCENT' WHERE id = '${ID.R1}';`);
    await db.fails(
      `UPDATE restaurants SET portion_display = 'FRACTION' WHERE id = '${ID.R1}';`,
      /invalid input value for enum portion_display/,
    );
  });
});

describe('participación: snapshot del ítem', () => {
  const D = uuid(700);

  it('BY_POSITION (porción, sin puntos), BY_POINTS (puntos, sin porción) y ambos', async () => {
    await db.exec(dist(D, '2026-09-21'));
    await db.exec(participationItem(uuid(701), D, ID.E1, '0.0220000000', 'NULL'));
    await db.exec(participationItem(uuid(702), D, ID.E2, 'NULL', '1.20'));
    await db.exec(participationItem(uuid(703), D, ID.E3, '0.0220000000', '0.80'));
    expect(
      await db.rows(
        `SELECT portion_snapshot::text AS portion, individual_points_snapshot::text AS points
         FROM daily_distribution_items WHERE daily_distribution_id = '${D}' ORDER BY id`,
      ),
    ).toEqual([
      { portion: '0.0220000000', points: null },
      { portion: null, points: '1.20' },
      { portion: '0.0220000000', points: '0.80' },
    ]);
  });

  it('sin porción ni puntos no hay ponderado: se rechaza', async () => {
    await db.exec(dist(D, '2026-09-21'));
    await db.fails(participationItem(uuid(701), D, ID.E1, 'NULL', 'NULL'), /ck_ddi_weight_inputs/);
  });

  it('los puntos usados son positivos', async () => {
    await db.exec(dist(D, '2026-09-21'));
    await db.fails(participationItem(uuid(701), D, ID.E1, 'NULL', '0'), /ck_ddi_individual_points/);
  });

  it('cerrado, el snapshot de puntos no cambia aunque cambien los puntos del empleado', async () => {
    await db.exec(dist(D, '2026-09-21'));
    await db.exec(tip(uuid(704), D, 'ARS', 1000, null, 1000));
    await db.exec(participationItem(uuid(701), D, ID.E1, 'NULL', '1.20'));
    await db.exec(closeDistribution(D, { total: 1000 }));

    await db.exec(`UPDATE employees SET individual_points = 3 WHERE id = '${ID.E1}';`);
    await db.fails(
      `UPDATE daily_distribution_items SET individual_points_snapshot = 3 WHERE id = '${uuid(701)}';`,
      /IMMUTABLE/,
    );
    expect(
      await db.rows(
        `SELECT individual_points_snapshot::text AS p FROM daily_distribution_items
         WHERE id = '${uuid(701)}'`,
      ),
    ).toEqual([{ p: '1.20' }]);
  });
});
