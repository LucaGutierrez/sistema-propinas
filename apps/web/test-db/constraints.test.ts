import { describe, it } from 'vitest';
import {
  ID,
  advance,
  closeDistribution,
  dist,
  draftDay,
  item,
  tip,
  useDatabase,
  uuid,
  voidDistribution,
} from './helpers';

const db = useDatabase();
const D1 = uuid(100); // distribución DRAFT reutilizada por varios tests

describe('CHECK: restaurante, catálogos y cotizaciones', () => {
  it.each([0, 8, -1])('week_starts_on = %i es inválido', async (day) => {
    await db.fails(
      `INSERT INTO restaurants (name, week_starts_on, pool_mode, updated_at) VALUES ('X', ${day}, 'SINGLE', now());`,
      /ck_restaurants_week_starts_on/,
    );
  });

  it.each([1, 4, 7])('week_starts_on = %i es válido', async (day) => {
    await db.exec(
      `INSERT INTO restaurants (name, week_starts_on, pool_mode, updated_at) VALUES ('X', ${day}, 'PER_TEAM', now());`,
    );
  });

  it.each(['0', '-1.00'])('el peso de un puesto (%s) debe ser > 0', async (weight) => {
    await db.fails(
      `INSERT INTO positions (restaurant_id, team_id, name, weight, updated_at)
       VALUES ('${ID.R1}', '${ID.T1}', 'Peso malo', ${weight}, now());`,
      /ck_positions_weight_positive/,
    );
  });

  it.each(['0', '-1180'])('la cotización (%s) debe ser > 0', async (rate) => {
    await db.fails(
      `INSERT INTO exchange_rates (restaurant_id, date, rate, created_by, updated_at)
       VALUES ('${ID.R1}', '2026-09-21', ${rate}, '${ID.U1}', now());`,
      /ck_exchange_rates_rate_positive/,
    );
  });

  it('el contador de rate_limits no puede ser negativo', async () => {
    await db.fails(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ('login:ip:1.2.3.4', now(), -1);`,
      /ck_rate_limits_count/,
    );
  });
});

describe('CHECK: distribución diaria', () => {
  it('SINGLE no puede tener equipo', async () => {
    await db.fails(
      dist(D1, '2026-09-21', { mode: 'SINGLE', team: ID.T1 }),
      /ck_daily_distributions_pool_team/,
    );
  });

  it('PER_TEAM exige equipo', async () => {
    await db.fails(
      dist(D1, '2026-09-21', { mode: 'PER_TEAM', team: null }),
      /ck_daily_distributions_pool_team/,
    );
  });

  it('SINGLE sin equipo y PER_TEAM con equipo son válidos', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.exec(dist(uuid(101), '2026-09-22', { mode: 'PER_TEAM', team: ID.T1 }));
  });

  it('los totales no pueden ser negativos', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(
      `UPDATE daily_distributions SET total_cents = -1, total_final_cents = -1 WHERE id = '${D1}';`,
      /ck_daily_distributions_amounts/,
    );
  });

  it('total final = total - adelantos', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(
      `UPDATE daily_distributions SET total_cents = 1000, total_advances_cents = 100, total_final_cents = 1000 WHERE id = '${D1}';`,
      /ck_daily_distributions_final/,
    );
  });

  it('CLOSED exige closed_at y closed_by', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(
      `UPDATE daily_distributions SET status = 'CLOSED' WHERE id = '${D1}';`,
      /ck_daily_distributions_closed/,
    );
  });

  it('VOIDED exige quién, cuándo y un motivo de al menos 10 caracteres', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(voidDistribution(D1, 'oops'), /ck_daily_distributions_voided/);
    await db.fails(voidDistribution(D1, '          '), /ck_daily_distributions_voided/);
    await db.fails(
      `UPDATE daily_distributions SET status = 'VOIDED' WHERE id = '${D1}';`,
      /ck_daily_distributions_voided/,
    );
    await db.exec(voidDistribution(D1, 'entered by mistake'));
  });

  it('solo una distribución CLOSED puede pertenecer a una liquidación', async () => {
    await db.exec(
      dist(D1, '2026-09-21') +
        `INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, created_by, updated_at)
         VALUES ('${uuid(300)}', '${ID.R1}', '2026-09-21', '2026-09-27', '${ID.U1}', now());`,
    );
    await db.fails(
      `UPDATE daily_distributions SET settlement_id = '${uuid(300)}' WHERE id = '${D1}';`,
      /ck_daily_distributions_settlement_only_closed/,
    );
  });
});

describe('CHECK: propinas (tip_entries)', () => {
  it('el monto debe ser positivo', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(tip(uuid(1), D1, 'ARS', 0, null, 0), /ck_tip_entries_amount_positive/);
    await db.fails(tip(uuid(1), D1, 'ARS', -5, null, -5), /ck_tip_entries_amount_positive/);
  });

  it('una propina en USD exige cotización', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(tip(uuid(1), D1, 'USD', 5000, null, 5900000), /ck_tip_entries_usd_has_rate/);
  });

  it('una propina en ARS no puede llevar cotización', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(tip(uuid(1), D1, 'ARS', 2000, '1180', 2000), /ck_tip_entries_usd_has_rate/);
  });

  it('una propina en ARS no se convierte (ARS == original)', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(tip(uuid(1), D1, 'ARS', 100, null, 200), /ck_tip_entries_ars_no_conversion/);
  });

  it('la cotización guardada debe ser > 0', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(tip(uuid(1), D1, 'USD', 5000, '0', 0), /ck_tip_entries_rate_positive/);
  });

  it('acepta ARS y USD (con cotización de 6 decimales) bien formados', async () => {
    await db.exec(
      dist(D1, '2026-09-21') +
        tip(uuid(1), D1, 'ARS', 2000, null, 2000) +
        tip(uuid(2), D1, 'USD', 5000, '1180.123456', 5900617),
    );
  });
});

describe('CHECK: ítems de la distribución diaria', () => {
  it.each(['0', '-1', '24.01', '25'])(
    'las horas (%s) deben estar entre 0 (exclusivo) y 24',
    async (hours) => {
      await db.exec(dist(D1, '2026-09-21'));
      await db.fails(item(uuid(1), D1, ID.E1, { hours }), /ck_ddi_hours/);
    },
  );

  it('acepta exactamente 24 horas y horas decimales', async () => {
    await db.exec(
      dist(D1, '2026-09-21') +
        item(uuid(1), D1, ID.E1, { hours: '24' }) +
        item(uuid(2), D1, ID.E2, { hours: '7.5' }),
    );
  });

  it.each(['0', '-1'])('el peso del ítem (%s) debe ser > 0', async (weight) => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(item(uuid(1), D1, ID.E1, { weight }), /ck_ddi_weight/);
  });

  it('el porcentaje debe estar entre 0 y 1', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(item(uuid(1), D1, ID.E1, { percentage: '1.5' }), /ck_ddi_percentage/);
    await db.fails(item(uuid(1), D1, ID.E1, { percentage: '-0.1' }), /ck_ddi_percentage/);
  });

  it('el importe no puede ser negativo', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    // Un importe negativo lo rechazan a la vez ck_ddi_amount y ck_ddi_advances; PostgreSQL informa la primera.
    await db.fails(item(uuid(1), D1, ID.E1, { amount: -1, final: -1 }), /ck_ddi_(amount|advances)/);
  });

  it('los adelantos del ítem no pueden superar el importe', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(item(uuid(1), D1, ID.E1, { amount: 100, advances: 200 }), /ck_ddi_advances/);
  });

  it('importe final = importe - adelantos', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(
      item(uuid(1), D1, ID.E1, { amount: 1000, advances: 0, final: 999 }),
      /ck_ddi_final/,
    );
    await db.fails(
      item(uuid(1), D1, ID.E1, { amount: 1000, advances: 300, final: 800 }),
      /ck_ddi_final/,
    );
    await db.exec(item(uuid(1), D1, ID.E1, { amount: 1000, advances: 300, final: 700 }));
  });
});

describe('unicidad', () => {
  it('un empleado aparece una sola vez por distribución', async () => {
    await db.exec(dist(D1, '2026-09-21') + item(uuid(1), D1, ID.E1));
    await db.fails(
      item(uuid(2), D1, ID.E1),
      /daily_distribution_items_daily_distribution_id_employee_id_key/,
    );
  });

  it('el mismo empleado puede estar en distintas distribuciones', async () => {
    await db.exec(
      dist(D1, '2026-09-21') +
        item(uuid(1), D1, ID.E1) +
        dist(uuid(101), '2026-09-22') +
        item(uuid(2), uuid(101), ID.E1),
    );
  });

  it('email de usuario único', async () => {
    await db.fails(
      `INSERT INTO users (email, name, updated_at) VALUES ('ana@example.com', 'Otra Ana', now());`,
      /users_email_key/,
    );
  });

  it('nombre de equipo único por restaurante', async () => {
    await db.fails(
      `INSERT INTO teams (restaurant_id, name, updated_at) VALUES ('${ID.R1}', 'Salon', now());`,
      /teams_restaurant_id_name_key/,
    );
  });

  it('nombre de puesto único por equipo, pero repetible en otro equipo', async () => {
    await db.fails(
      `INSERT INTO positions (restaurant_id, team_id, name, weight, updated_at) VALUES ('${ID.R1}', '${ID.T1}', 'Mozo', 1, now());`,
      /positions_team_id_name_key/,
    );
    await db.exec(
      `INSERT INTO positions (restaurant_id, team_id, name, weight, updated_at) VALUES ('${ID.R1}', '${ID.T2}', 'Mozo', 1, now());`,
    );
  });

  it('una membresía por usuario y restaurante', async () => {
    await db.exec(
      `INSERT INTO memberships (user_id, restaurant_id, role, updated_at) VALUES ('${ID.U1}', '${ID.R1}', 'OWNER', now());`,
    );
    await db.fails(
      `INSERT INTO memberships (user_id, restaurant_id, role, updated_at) VALUES ('${ID.U1}', '${ID.R1}', 'VIEWER', now());`,
      /memberships_user_id_restaurant_id_key/,
    );
  });

  it('una cotización por restaurante, fecha y par de monedas', async () => {
    const insert = (rate: string) =>
      `INSERT INTO exchange_rates (restaurant_id, date, rate, created_by, updated_at)
       VALUES ('${ID.R1}', '2026-09-21', ${rate}, '${ID.U1}', now());`;
    await db.exec(insert('1180'));
    await db.fails(insert('1190'), /exchange_rates_restaurant_id_date_currency_pair_key/);
  });
});

describe('índice único parcial: una distribución vigente por día y pozo', () => {
  it('rechaza dos distribuciones SINGLE vigentes el mismo día', async () => {
    await db.exec(dist(D1, '2026-09-21'));
    await db.fails(dist(uuid(101), '2026-09-21'), /ux_daily_distributions_active/);
  });

  it('rechaza dos pozos del mismo equipo el mismo día, pero acepta equipos distintos', async () => {
    await db.exec(dist(D1, '2026-09-21', { mode: 'PER_TEAM', team: ID.T1 }));
    await db.fails(
      dist(uuid(101), '2026-09-21', { mode: 'PER_TEAM', team: ID.T1 }),
      /ux_daily_distributions_active/,
    );
    await db.exec(dist(uuid(102), '2026-09-21', { mode: 'PER_TEAM', team: ID.T2 }));
  });

  it('una distribución anulada libera el día para una nueva', async () => {
    await db.exec(
      draftDay(100, '2026-09-21') + closeDistribution(uuid(100)) + voidDistribution(uuid(100)),
    );
    await db.exec(dist(uuid(110), '2026-09-21'));
  });

  it('el mismo día en otro restaurante no choca (índice por restaurante)', async () => {
    await db.exec(
      `INSERT INTO restaurants (id, name, pool_mode, updated_at) VALUES ('${uuid(11)}', 'Otro', 'SINGLE', now());` +
        dist(D1, '2026-09-21') +
        `INSERT INTO daily_distributions (restaurant_id, date, pool_mode, created_by, updated_at)
         VALUES ('${uuid(11)}', '2026-09-21', 'SINGLE', '${ID.U1}', now());`,
    );
  });
});

describe('CHECK: adelantos (ver también advances.test.ts)', () => {
  it('el monto debe ser positivo', async () => {
    await db.fails(advance(uuid(150), { amount: 0 }), /ck_advances_amount_positive/);
  });
});
