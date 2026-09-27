import { describe, expect, it } from 'vitest';
import { ID, useDatabase, uuid } from './helpers';

/*
 * Acceso (memberships) y tablas de Better Auth: lo que la base garantiza por sí misma, aunque
 * la aplicación tenga un error. Los datos de referencia traen U1, U2, R1 y los empleados
 * E1–E3 de R1.
 */

const db = useDatabase();
const R2 = uuid(900);
const E_R2 = uuid(901);

const otherRestaurant = `
  INSERT INTO restaurants (id, name, updated_at) VALUES ('${R2}', 'Otro', now());
  INSERT INTO employees (id, restaurant_id, first_name, last_name, updated_at)
    VALUES ('${E_R2}', '${R2}', 'Otra', 'Persona', now());`;

const member = (
  user: string,
  role: string,
  opts: { restaurant?: string; employee?: string } = {},
): string =>
  `INSERT INTO memberships (user_id, restaurant_id, role, employee_id, updated_at)
   VALUES ('${user}', '${opts.restaurant ?? ID.R1}', '${role}',
           ${opts.employee ? `'${opts.employee}'` : 'NULL'}, now());`;

describe('memberships: roles', () => {
  it('los roles son OWNER, MANAGER, EDITOR, VIEWER y SELF (ADMIN ya no existe)', async () => {
    await db.fails(member(ID.U1, 'ADMIN'), /invalid input value for enum/);
    await db.exec(member(ID.U1, 'MANAGER') + member(ID.U2, 'EDITOR'));
  });

  it('hay un solo OWNER por restaurante', async () => {
    await db.exec(member(ID.U1, 'OWNER'));
    await db.fails(member(ID.U2, 'OWNER'), /ux_memberships_one_owner/);
  });

  it('un usuario puede ser OWNER de varios restaurantes y miembro con otro rol en otro', async () => {
    await db.exec(
      otherRestaurant + member(ID.U1, 'OWNER') + member(ID.U1, 'OWNER', { restaurant: R2 }),
    );
    await db.exec(member(ID.U2, 'VIEWER') + member(ID.U2, 'MANAGER', { restaurant: R2 }));
  });

  it('un usuario tiene una sola membresía por restaurante', async () => {
    await db.exec(member(ID.U1, 'VIEWER'));
    await db.fails(member(ID.U1, 'EDITOR'), /memberships_user_id_restaurant_id_key/);
  });
});

describe('memberships: empleado vinculado', () => {
  it('SELF exige un empleado vinculado', async () => {
    await db.fails(member(ID.U2, 'SELF'), /ck_memberships_self_employee/);
    await db.exec(member(ID.U2, 'SELF', { employee: ID.E1 }));
  });

  it('otros roles pueden tener (o no) un empleado vinculado', async () => {
    await db.exec(member(ID.U1, 'MANAGER', { employee: ID.E2 }) + member(ID.U2, 'VIEWER'));
  });

  it('el empleado vinculado tiene que ser del mismo restaurante', async () => {
    await db.exec(otherRestaurant);
    await db.fails(
      member(ID.U2, 'SELF', { employee: E_R2 }),
      /RULE: the linked employee must belong to the restaurant/,
    );
    await db.exec(member(ID.U2, 'SELF', { restaurant: R2, employee: E_R2 }));
  });

  it('no se puede mover la membresía a otro restaurante dejando el empleado del primero', async () => {
    await db.exec(otherRestaurant + member(ID.U2, 'SELF', { employee: ID.E1 }));
    await db.fails(
      `UPDATE memberships SET restaurant_id = '${R2}' WHERE user_id = '${ID.U2}';`,
      /RULE: the linked employee must belong to the restaurant/,
    );
  });

  it('un empleado se vincula a una sola membresía', async () => {
    await db.exec(member(ID.U1, 'VIEWER', { employee: ID.E1 }));
    await db.fails(member(ID.U2, 'SELF', { employee: ID.E1 }), /ux_memberships_employee/);
  });

  it('un empleado vinculado no se pasa a otro restaurante', async () => {
    await db.exec(otherRestaurant + member(ID.U2, 'SELF', { employee: ID.E1 }));
    await db.fails(
      `UPDATE employees SET restaurant_id = '${R2}' WHERE id = '${ID.E1}';`,
      /RULE: an employee linked to a membership cannot change restaurant/,
    );
  });
});

describe('Better Auth: users, sessions, accounts', () => {
  it('el email del usuario se guarda en minúsculas', async () => {
    await db.fails(
      `INSERT INTO users (email, name, updated_at) VALUES ('Mayus@Example.com', 'X', now());`,
      /ck_users_email_lowercase/,
    );
  });

  it('un usuario nace sin email verificado', async () => {
    const rows = await db.rows<{ email_verified: boolean }>(
      `SELECT email_verified FROM users WHERE id = '${ID.U1}'`,
    );
    expect(rows[0]?.email_verified).toBe(false);
  });

  it('el token de sesión es único y la cuenta es única por proveedor', async () => {
    await db.exec(
      `INSERT INTO sessions (user_id, token, expires_at, updated_at)
         VALUES ('${ID.U1}', 'tok', now() + interval '1 day', now());
       INSERT INTO accounts (user_id, account_id, provider_id, password, updated_at)
         VALUES ('${ID.U1}', '${ID.U1}', 'credential', 'hash', now());`,
    );
    await db.fails(
      `INSERT INTO sessions (user_id, token, expires_at, updated_at)
         VALUES ('${ID.U2}', 'tok', now() + interval '1 day', now());`,
      /sessions_token_key/,
    );
    await db.fails(
      `INSERT INTO accounts (user_id, account_id, provider_id, updated_at)
         VALUES ('${ID.U2}', '${ID.U1}', 'credential', now());`,
      /accounts_provider_id_account_id_key/,
    );
  });

  it('borrar un usuario sin membresías elimina sus sesiones y cuentas (CASCADE)', async () => {
    const tmp = uuid(950);
    await db.exec(
      `INSERT INTO users (id, email, name, updated_at) VALUES ('${tmp}', 'tmp2@example.com', 'Tmp', now());
       INSERT INTO sessions (user_id, token, expires_at, updated_at)
         VALUES ('${tmp}', 'tok-tmp', now() + interval '1 day', now());
       INSERT INTO accounts (user_id, account_id, provider_id, updated_at)
         VALUES ('${tmp}', '${tmp}', 'credential', now());
       DELETE FROM users WHERE id = '${tmp}';`,
    );
    const rows = await db.rows<{ count: number }>(
      `SELECT (SELECT count(*) FROM sessions WHERE user_id = '${tmp}')
            + (SELECT count(*) FROM accounts WHERE user_id = '${tmp}') AS count`,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('un usuario con membresía no se puede borrar (RESTRICT)', async () => {
    await db.exec(member(ID.U1, 'OWNER'));
    await db.fails(`DELETE FROM users WHERE id = '${ID.U1}';`, /memberships_user_id_fkey/);
  });

  it('el contador de auth_rate_limits no puede ser negativo', async () => {
    await db.fails(
      `INSERT INTO auth_rate_limits (key, count, last_request) VALUES ('ip/sign-in', -1, 0);`,
      /ck_auth_rate_limits_count/,
    );
  });
});
