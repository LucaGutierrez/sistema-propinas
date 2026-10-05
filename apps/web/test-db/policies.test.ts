import { describe, expect, it } from 'vitest';
import {
  ID,
  closeSettlement,
  periodHours,
  policyChange,
  policyVersion,
  settlement,
  useDatabase,
  uuid,
  versionPosition,
  voidSettlement,
} from './helpers';

/*
 * Política de distribución versionada (CONFIG-MODEL.md): una versión nunca se edita, sus puestos
 * se fijan al crearla, cada período está fijado a una versión y solo cambia de versión dejando
 * registro. El seed crea la versión 1 (estándar) de R1 en otra transacción, ya confirmada.
 */

const db = useDatabase();

const V2 = uuid(51);
const R2 = uuid(11);
const P2 = uuid(31);
const S1 = uuid(300);
const S2 = uuid(301);

/** Versión 2 de R1 (cambio sobre la 1) con su puesto, en una sola transacción, y vigente. */
const newVersion =
  policyVersion(V2, { number: 2, origin: 'CHANGE', previous: ID.V1, rounding: 'PESO' }) +
  versionPosition(V2, ID.P1, '0.0144444444') +
  `UPDATE restaurants SET current_policy_version_id = '${V2}' WHERE id = '${ID.R1}';`;

/** Otro restaurante con su puesto y su propia versión estándar. */
const otherRestaurant =
  `INSERT INTO restaurants (id, name, updated_at) VALUES ('${R2}', 'Otro', now());
   INSERT INTO positions (id, restaurant_id, name, updated_at) VALUES ('${P2}', '${R2}', 'Bacha', now());` +
  policyVersion(uuid(52), { restaurant: R2 }) +
  versionPosition(uuid(52), P2);

describe('versiones de la política', () => {
  it('el seed dejó la versión 1 estándar vigente, con la plantilla registrada', async () => {
    const [row] = await db.rows<{ current: string; origin: string; code: string; version: number }>(
      `SELECT r.current_policy_version_id AS current, v.origin::text AS origin,
              v.template_code AS code, v.template_version AS version
       FROM restaurants r JOIN distribution_policy_versions v ON v.id = r.current_policy_version_id
       WHERE r.id = '${ID.R1}'`,
    );
    expect(row).toEqual({ current: ID.V1, origin: 'STANDARD', code: 'gutip-standard', version: 1 });
  });

  it('una versión nueva queda vigente y conserva la anterior intacta', async () => {
    await db.exec(newVersion);
    const rows = await db.rows<{ number: number; rounding: string; portion: string }>(
      `SELECT v.number, v.rounding_unit::text AS rounding, p.portion::text AS portion
       FROM distribution_policy_versions v JOIN policy_version_positions p ON p.version_id = v.id
       WHERE v.restaurant_id = '${ID.R1}' ORDER BY v.number`,
    );
    expect(rows).toEqual([
      { number: 1, rounding: 'CENT', portion: '0.0220000000' },
      { number: 2, rounding: 'PESO', portion: '0.0144444444' },
    ]);
  });

  it('el número de versión es único por restaurante', async () => {
    await db.fails(
      policyVersion(V2, { number: 1, origin: 'CHANGE', previous: ID.V1 }),
      /distribution_policy_versions_restaurant_id_number_key/,
    );
  });

  it('una versión no se edita ni se borra', async () => {
    const appendOnly = /IMMUTABLE: distribution_policy_versions is append-only/;
    await db.fails(
      `UPDATE distribution_policy_versions SET rounding_unit = 'PESO' WHERE id = '${ID.V1}';`,
      appendOnly,
    );
    await db.fails(`DELETE FROM distribution_policy_versions WHERE id = '${ID.V1}';`, appendOnly);
    await db.fails(`TRUNCATE distribution_policy_versions CASCADE;`, appendOnly);
  });

  it.each([0, 8])('el día de inicio del período (%i) va de 1 a 7', async (weekday) => {
    await db.fails(
      policyVersion(V2, { number: 2, origin: 'CHANGE', previous: ID.V1, weekday }),
      /ck_policy_versions_weekday/,
    );
  });

  it('el lunes es el estándar, no una regla: otra versión puede empezar el jueves', async () => {
    await db.exec(policyVersion(V2, { number: 2, origin: 'CHANGE', previous: ID.V1, weekday: 4 }));
  });

  it('el origen exige su dato: CHANGE la versión anterior, COPY la versión copiada', async () => {
    await db.fails(
      policyVersion(V2, { number: 2, origin: 'CHANGE' }),
      /ck_policy_versions_change_has_previous/,
    );
    await db.fails(
      policyVersion(V2, { number: 2, origin: 'COPY' }),
      /ck_policy_versions_copy_has_source/,
    );
  });

  it('una política copiada de otro restaurante es independiente y registra su origen', async () => {
    await db.exec(otherRestaurant);
    await db.exec(
      `INSERT INTO restaurants (id, name, updated_at) VALUES ('${uuid(12)}', 'Copia', now());` +
        policyVersion(uuid(53), { restaurant: uuid(12), origin: 'COPY', copiedFrom: uuid(52) }),
    );
  });

  it('la versión anterior tiene que ser del mismo restaurante', async () => {
    await db.exec(otherRestaurant);
    await db.fails(
      policyVersion(uuid(53), { restaurant: R2, number: 2, origin: 'CHANGE', previous: ID.V1 }),
      /previous policy version must belong to the same restaurant/,
    );
  });
});

describe('puestos de una versión (porción)', () => {
  it('no se agregan puestos a una versión ya creada (se crea una versión nueva)', async () => {
    await db.exec(
      `INSERT INTO positions (id, restaurant_id, name, updated_at) VALUES ('${uuid(32)}', '${ID.R1}', 'Runner', now());`,
    );
    await db.fails(
      versionPosition(ID.V1, uuid(32)),
      /positions can only be added to a policy version in the transaction that creates it/,
    );
  });

  it('la porción de una versión no se edita ni se borra', async () => {
    const appendOnly = /IMMUTABLE: policy_version_positions is append-only/;
    await db.fails(
      `UPDATE policy_version_positions SET portion = 0.03 WHERE version_id = '${ID.V1}';`,
      appendOnly,
    );
    await db.fails(
      `DELETE FROM policy_version_positions WHERE version_id = '${ID.V1}';`,
      appendOnly,
    );
  });

  it('el puesto tiene que ser del restaurante de la versión', async () => {
    await db.exec(otherRestaurant);
    await db.fails(
      policyVersion(V2, { number: 2, origin: 'CHANGE', previous: ID.V1 }) + versionPosition(V2, P2),
      /the position must belong to the restaurant of the policy version/,
    );
  });

  it.each(['0', '-0.01'])('la porción (%s) debe ser > 0', async (portion) => {
    await db.fails(
      policyVersion(V2, { number: 2, origin: 'CHANGE', previous: ID.V1 }) +
        versionPosition(V2, ID.P1, portion),
      /ck_policy_version_positions_portion/,
    );
  });

  /** Versión 2 por sectores con un puesto en una etapa (stage y stage_percent como SQL). */
  const stagedVersion = (stage: string, percent: string) =>
    policyVersion(V2, { number: 2, origin: 'CHANGE', previous: ID.V1 }) +
    `INSERT INTO policy_version_positions (version_id, position_id, portion, stage, stage_percent)
       VALUES ('${V2}', '${ID.P1}', 0.022, ${stage}, ${percent});`;

  it('reparto por sectores: guarda la etapa y el porcentaje (2 decimales) de cada puesto', async () => {
    await db.exec(stagedVersion('1', '12.5'));
    const [row] = await db.rows<{ stage: number; stage_percent: string }>(
      `SELECT stage, stage_percent::text AS stage_percent
       FROM policy_version_positions WHERE version_id = '${V2}'`,
    );
    expect(row).toEqual({ stage: 1, stage_percent: '12.50' });
  });

  it.each([
    ['1', 'NULL', /ck_pvp_stage_pair/],
    ['NULL', '30', /ck_pvp_stage_pair/],
    ['0', '30', /"ck_pvp_stage"/],
    ['10', '30', /"ck_pvp_stage"/],
    ['1', '0', /ck_pvp_stage_percent/],
    ['1', '100.01', /ck_pvp_stage_percent/],
  ])(
    'reparto por sectores: etapa %s y porcentaje %s se rechazan',
    async (stage, percent, error) => {
      await db.fails(stagedVersion(stage, percent), error);
    },
  );

  it('la porción guarda 10 decimales exactos (0,65/45 = 0,0144444444)', async () => {
    await db.exec(newVersion);
    const [row] = await db.rows<{ portion: string }>(
      `SELECT portion::text AS portion FROM policy_version_positions WHERE version_id = '${V2}'`,
    );
    expect(row?.portion).toBe('0.0144444444');
  });

  it('renombrar un puesto no crea versión ni toca las porciones', async () => {
    await db.exec(`UPDATE positions SET name = 'Camarero' WHERE id = '${ID.P1}';`);
    const [row] = await db.rows<{ versions: number; portion: string }>(
      `SELECT (SELECT count(*)::int FROM distribution_policy_versions WHERE restaurant_id = '${ID.R1}') AS versions,
              (SELECT portion::text FROM policy_version_positions WHERE version_id = '${ID.V1}') AS portion`,
    );
    expect(row).toEqual({ versions: 1, portion: '0.0220000000' });
  });

  it('un puesto puede no pertenecer a ningún equipo', async () => {
    await db.exec(
      `INSERT INTO positions (restaurant_id, team_id, name, updated_at) VALUES ('${ID.R1}', NULL, 'Bacha', now());`,
    );
  });
});

describe('versión vigente del restaurante', () => {
  it('tiene que ser una versión del mismo restaurante', async () => {
    await db.exec(otherRestaurant);
    await db.fails(
      `UPDATE restaurants SET current_policy_version_id = '${uuid(52)}' WHERE id = '${ID.R1}';`,
      /the current policy version must belong to the restaurant/,
    );
  });

  it('una vez que hay política, el restaurante no queda sin versión vigente', async () => {
    await db.fails(
      `UPDATE restaurants SET current_policy_version_id = NULL WHERE id = '${ID.R1}';`,
      /cannot be left without a current policy version/,
    );
  });
});

describe('período fijado a una versión', () => {
  it('el período se abre con una versión del mismo restaurante', async () => {
    await db.exec(otherRestaurant);
    await db.fails(
      settlement(S1, { version: uuid(52) }),
      /the policy version of a period must belong to its restaurant/,
    );
  });

  it('no cambia de versión sin registrar el cambio', async () => {
    await db.exec(settlement(S1) + newVersion);
    await db.fails(
      `UPDATE weekly_settlements SET policy_version_id = '${V2}' WHERE id = '${S1}';`,
      /must be recorded in period_policy_changes/,
    );
  });

  it('período abierto: pasa a la versión nueva con un registro automático', async () => {
    await db.exec(
      settlement(S1) +
        newVersion +
        policyChange(S1, ID.V1, V2) +
        `UPDATE weekly_settlements SET policy_version_id = '${V2}' WHERE id = '${S1}';`,
    );
    const [row] = await db.rows<{ version: string; automatic: boolean }>(
      `SELECT s.policy_version_id AS version, c.automatic
       FROM weekly_settlements s JOIN period_policy_changes c ON c.settlement_id = s.id
       WHERE s.id = '${S1}'`,
    );
    expect(row).toEqual({ version: V2, automatic: true });
  });

  it('el registro no autoriza otro cambio distinto al registrado', async () => {
    await db.exec(settlement(S1) + newVersion + policyChange(S1, ID.V1, V2));
    await db.exec(policyVersion(uuid(53), { number: 3, origin: 'CHANGE', previous: V2 }));
    await db.fails(
      `UPDATE weekly_settlements SET policy_version_id = '${uuid(53)}' WHERE id = '${S1}';`,
      /must be recorded in period_policy_changes/,
    );
  });

  it('el cambio parte de la versión actual del período', async () => {
    await db.exec(settlement(S1) + newVersion);
    await db.fails(
      policyChange(S1, V2, ID.V1, 'volver a la anterior'),
      /must start from the current version of the period/,
    );
  });

  it('un cambio no automático exige un motivo de al menos 10 caracteres', async () => {
    await db.exec(settlement(S1) + newVersion);
    await db.fails(policyChange(S1, ID.V1, V2, 'porque'), /ck_period_policy_changes_reason/);
  });

  it('el registro de cambios no se edita ni se borra', async () => {
    await db.exec(settlement(S1) + newVersion + policyChange(S1, ID.V1, V2));
    const appendOnly = /IMMUTABLE: period_policy_changes is append-only/;
    await db.fails(`UPDATE period_policy_changes SET automatic = false;`, appendOnly);
    await db.fails(`DELETE FROM period_policy_changes;`, appendOnly);
  });

  it('un período cerrado no cambia de versión', async () => {
    await db.exec(settlement(S1) + closeSettlement(S1) + newVersion);
    await db.fails(
      policyChange(S1, ID.V1, V2, 'recalcular con la nueva'),
      /only an OPEN period can change its policy version/,
    );
  });

  it('cerrar exige el snapshot de la configuración y la versión del cálculo', async () => {
    await db.exec(settlement(S1));
    await db.fails(
      `UPDATE weekly_settlements SET status = 'CLOSED', closed_at = now(), closed_by = '${ID.U1}',
         total_cents = 0, total_advances_cents = 0, total_final_cents = 0 WHERE id = '${S1}';`,
      /ck_weekly_settlements_closed_snapshot/,
    );
    await db.fails(
      `UPDATE weekly_settlements SET status = 'CLOSED', closed_at = now(), closed_by = '${ID.U1}',
         total_cents = 0, total_advances_cents = 0, total_final_cents = 0,
         policy_snapshot = '{}', calc_version = ' ' WHERE id = '${S1}';`,
      /ck_weekly_settlements_closed_snapshot/,
    );
  });

  it('el snapshot del cierre es inmutable', async () => {
    await db.exec(settlement(S1) + closeSettlement(S1));
    await db.fails(
      `UPDATE weekly_settlements SET policy_snapshot = '{"roundingUnit":"PESO"}' WHERE id = '${S1}';`,
      /IMMUTABLE: a CLOSED settlement cannot be modified/,
    );
  });

  it('rehacer: la revisión conserva la versión original salvo cambio explícito con motivo', async () => {
    await db.exec(
      settlement(S1) +
        closeSettlement(S1) +
        newVersion +
        voidSettlement(S1) +
        settlement(S2, { revision: 2, supersedes: S1 }),
    );
    const [kept] = await db.rows<{ version: string }>(
      `SELECT policy_version_id AS version FROM weekly_settlements WHERE id = '${S2}'`,
    );
    expect(kept?.version).toBe(ID.V1);

    await db.exec(
      policyChange(S2, ID.V1, V2, 'usar el redondeo nuevo') +
        `UPDATE weekly_settlements SET policy_version_id = '${V2}' WHERE id = '${S2}';`,
    );
  });
});

describe('horas del período (period_hours)', () => {
  it('guarda el total de horas del período por empleado, una fila por empleado', async () => {
    await db.exec(settlement(S1) + periodHours(S1, ID.E1, '42.5'));
    await db.fails(periodHours(S1, ID.E1, '10'), /period_hours_settlement_id_employee_id_key/);
  });

  it('las horas no pueden ser negativas', async () => {
    await db.exec(settlement(S1));
    await db.fails(periodHours(S1, ID.E1, '-1'), /ck_period_hours_nonnegative/);
  });

  it('el tope es 24 × días del período, no un límite de negocio', async () => {
    await db.exec(settlement(S1) + periodHours(S1, ID.E1, '168'));
    await db.fails(periodHours(S1, ID.E2, '168.01'), /exceed the length of the period/);
  });

  it('empleado y período tienen que ser del mismo restaurante', async () => {
    await db.exec(otherRestaurant + settlement(S1));
    await db.exec(
      `INSERT INTO employees (id, restaurant_id, first_name, last_name, updated_at)
       VALUES ('${uuid(43)}', '${R2}', 'Otro', 'Empleado', now());`,
    );
    await db.fails(
      periodHours(S1, uuid(43), '10'),
      /period, employee and hours must belong to the same restaurant/,
    );
  });

  it('con el período cerrado las horas no se cargan, editan ni borran', async () => {
    await db.exec(settlement(S1) + periodHours(S1, ID.E1, '40') + closeSettlement(S1));
    const closed = /hours of a period can only change while it is OPEN/;
    await db.fails(periodHours(S1, ID.E2, '10'), closed);
    await db.fails(`UPDATE period_hours SET hours = 41 WHERE settlement_id = '${S1}';`, closed);
    await db.fails(`DELETE FROM period_hours WHERE settlement_id = '${S1}';`, closed);
  });
});
