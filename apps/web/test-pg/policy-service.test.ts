import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { STANDARD_VALUES } from '@/lib/demo-store/config';
import { AccessError, resolveAccess } from '@/server/context';
import {
  countClosedPeriodsByVersion,
  getCurrentPolicy,
  getDistributionConfigView,
  getPolicyVersion,
  listPolicyVersions,
} from '@/server/policy/repository';
import {
  bootstrapRestaurant,
  changePolicy,
  changePolicyInTx,
  renamePosition,
  TX_OPTIONS,
  type Actor,
} from '@/server/policy/service';

/*
 * Servicio de la política de distribución contra PostgreSQL real, con Prisma: el mismo código
 * que usa la pantalla "Configuración de distribución". Cada test crea su propio restaurante.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

/** Restaurante nuevo inicializado con la política estándar. */
async function setup(name = 'Local de prueba') {
  const input = {
    restaurantId: randomUUID(),
    restaurantName: name,
    operatorEmail: `op-${randomUUID()}@example.invalid`,
    operatorName: 'Operador',
  };
  const result = await bootstrapRestaurant(db, input);
  if (!result.ok) throw new Error(result.error);
  const actor: Actor = { restaurantId: input.restaurantId, userId: result.value.userId };
  return { input, actor, v1: result.value.versionId };
}

async function positionId(restaurantId: string, name: string): Promise<string> {
  const p = await db.position.findFirstOrThrow({ where: { restaurantId, name } });
  return p.id;
}

async function ok<T>(promise: Promise<{ ok: true; value: T } | { ok: false; error: string }>) {
  const result = await promise;
  if (!result.ok) throw new Error(`Se esperaba ok, falló: ${result.error}`);
  return result.value;
}

describe('bootstrap del restaurante', () => {
  it('crea operador, membresía OWNER, restaurante y la política STANDARD v1 vigente', async () => {
    const { input, actor, v1 } = await setup();
    const policy = await getCurrentPolicy(db, input.restaurantId);
    expect(policy).toMatchObject({
      id: v1,
      number: 1,
      origin: 'STANDARD',
      templateCode: 'gutip-standard',
      templateVersion: 1,
      previousVersionId: null,
      summary: 'Configuración estándar de GUTIP (v1)',
      createdById: actor.userId,
      values: STANDARD_VALUES,
    });
    expect(policy?.columns.periodStartWeekday).toBe(1);
    expect(policy?.positions.map((p) => [p.name, p.portion, p.factor])).toEqual([
      ['Supervisor', '0.0140000000', '0,014'],
      ['Barra', '0.0220000000', '0,022'],
      ['Salón', '0.0220000000', '0,022'],
      ['Bacha', '0.0070000000', '0,007'],
    ]);
    const membership = await db.membership.findFirstOrThrow({
      where: { restaurantId: input.restaurantId },
    });
    expect(membership).toMatchObject({ userId: actor.userId, role: 'OWNER' });
    expect(await db.employee.count({ where: { restaurantId: input.restaurantId } })).toBe(0);
  });

  it('es idempotente: la segunda vez no crea ni duplica nada', async () => {
    const { input, v1 } = await setup();
    const again = await ok(bootstrapRestaurant(db, input));
    expect(again.created).toEqual({
      user: false,
      restaurant: false,
      membership: false,
      policy: false,
    });
    expect(again.versionId).toBe(v1);
    const rid = input.restaurantId;
    expect(await db.distributionPolicyVersion.count({ where: { restaurantId: rid } })).toBe(1);
    expect(await db.position.count({ where: { restaurantId: rid } })).toBe(4);
    expect(await db.policyVersionPosition.count({ where: { versionId: v1 } })).toBe(4);
    expect(await db.membership.count({ where: { restaurantId: rid } })).toBe(1);
    expect(await db.user.count({ where: { email: input.operatorEmail } })).toBe(1);
  });

  it('dos bootstraps del mismo restaurante a la vez no duplican la política', async () => {
    const input = {
      restaurantId: randomUUID(),
      restaurantName: 'Concurrente',
      operatorEmail: `op-${randomUUID()}@example.invalid`,
      operatorName: 'Operador',
    };
    // Uno crea; el otro, o encuentra todo hecho, o choca con la clave primaria y falla entero.
    await Promise.allSettled([bootstrapRestaurant(db, input), bootstrapRestaurant(db, input)]);
    await ok(bootstrapRestaurant(db, input));
    const rid = input.restaurantId;
    expect(await db.distributionPolicyVersion.count({ where: { restaurantId: rid } })).toBe(1);
    expect(await db.position.count({ where: { restaurantId: rid } })).toBe(4);
  });
});

describe('cambios de política', () => {
  it('cambiar una porción crea una versión nueva vigente y conserva la anterior', async () => {
    const { input, actor, v1 } = await setup();
    const salon = await positionId(input.restaurantId, 'Salón');
    const change = await ok(
      changePolicy(db, actor, { kind: 'portion', positionId: salon, factor: '0,025' }),
    );
    expect(change).toMatchObject({ number: 2, summary: 'Salón: porción 0,022 → 0,025' });

    const current = await getCurrentPolicy(db, input.restaurantId);
    expect(current).toMatchObject({
      id: change.versionId,
      number: 2,
      origin: 'CHANGE',
      previousVersionId: v1,
      templateCode: null,
      createdById: actor.userId,
    });
    // Mismo puesto (identidad estable), porción distinta entre versiones.
    const previous = await getPolicyVersion(db, input.restaurantId, v1);
    const portionOf = (v: typeof current, id: string) =>
      v?.positions.find((p) => p.positionId === id)?.portion;
    expect(portionOf(previous, salon)).toBe('0.0220000000');
    expect(portionOf(current, salon)).toBe('0.0250000000');
    expect(current?.positions.map((p) => p.positionId)).toEqual(
      previous?.positions.map((p) => p.positionId),
    );
    // Los demás puestos conservan su porción exacta.
    const barra = await positionId(input.restaurantId, 'Barra');
    expect(portionOf(current, barra)).toBe(portionOf(previous, barra));
  });

  it('la versión anterior es inmutable: la base rechaza modificarla', async () => {
    const { input, actor, v1 } = await setup();
    await ok(changePolicy(db, actor, { kind: 'value', key: 'rounding', value: 'PESO' }));
    await expect(
      db.distributionPolicyVersion.update({ where: { id: v1 }, data: { summary: 'editado' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.policyVersionPosition.updateMany({ where: { versionId: v1 }, data: { portion: '0.5' } }),
    ).rejects.toThrow(/append-only/);
    const v1Now = await getPolicyVersion(db, input.restaurantId, v1);
    expect(v1Now?.values.rounding).toBe('CENTAVO');
    expect(v1Now?.summary).toBe('Configuración estándar de GUTIP (v1)');
  });

  it('cambiar un parámetro guarda su columna tipada y actualiza la versión vigente', async () => {
    const { input, actor } = await setup();
    const change = await ok(
      changePolicy(db, actor, { kind: 'value', key: 'envelopes', value: 'ENCARGADO_Y_EDITOR' }),
    );
    const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: input.restaurantId } });
    expect(restaurant.currentPolicyVersionId).toBe(change.versionId);
    const row = await db.distributionPolicyVersion.findUniqueOrThrow({
      where: { id: change.versionId },
    });
    expect(row.envelopeHandlers).toBe('MANAGER_AND_EDITOR');
    expect(row.periodStartWeekday).toBe(1);
  });

  it('agregar un puesto crea su identidad y una versión con todos los puestos', async () => {
    const { input, actor } = await setup();
    const change = await ok(
      changePolicy(db, actor, { kind: 'addPosition', name: 'Cocina', factor: '0,015' }),
    );
    const current = await getCurrentPolicy(db, input.restaurantId);
    expect(current?.id).toBe(change.versionId);
    expect(current?.positions.map((p) => [p.name, p.factor])).toEqual([
      ['Supervisor', '0,014'],
      ['Barra', '0,022'],
      ['Salón', '0,022'],
      ['Bacha', '0,007'],
      ['Cocina', '0,015'],
    ]);
    expect(await db.position.count({ where: { restaurantId: input.restaurantId } })).toBe(5);
  });

  it('un cambio inválido no crea nada y devuelve el mismo mensaje que la demo', async () => {
    const { input, actor } = await setup();
    const salon = await positionId(input.restaurantId, 'Salón');
    expect(
      await changePolicy(db, actor, { kind: 'portion', positionId: salon, factor: '0,022' }),
    ).toEqual({ ok: false, error: 'Esa ya es la porción vigente.' });
    expect(
      await changePolicy(db, actor, { kind: 'addPosition', name: 'BARRA', factor: '0,02' }),
    ).toEqual({ ok: false, error: 'Ya existe el puesto "BARRA".' });
    expect(
      await changePolicy(db, actor, { kind: 'value', key: 'splitTiming', value: 'POR_DIA' }),
    ).toEqual({ ok: false, error: 'GUTIP todavía no calcula con esa opción.' });
    expect(
      await db.distributionPolicyVersion.count({ where: { restaurantId: input.restaurantId } }),
    ).toBe(1);
  });

  it('historial: versiones de la más nueva a la más vieja, con sus períodos cerrados', async () => {
    const { input, actor, v1 } = await setup();
    await ok(changePolicy(db, actor, { kind: 'value', key: 'rounding', value: 'PESO' }));
    // Un período cerrado con la versión 1 (datos ficticios mínimos, sin personal).
    await db.$executeRaw`
      INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end, policy_version_id,
        created_by, status, closed_at, closed_by, total_cents, total_advances_cents,
        total_final_cents, policy_snapshot, calc_version, updated_at)
      VALUES (${randomUUID()}::uuid, ${input.restaurantId}::uuid, '2026-09-14', '2026-09-20',
        ${v1}::uuid, ${actor.userId}::uuid, 'CLOSED', now(), ${actor.userId}::uuid, 0, 0, 0,
        '{}'::jsonb, 'provisional-1', now())`;

    const history = await listPolicyVersions(db, input.restaurantId);
    expect(history.map((v) => [v.number, v.origin])).toEqual([
      [2, 'CHANGE'],
      [1, 'STANDARD'],
    ]);
    const closed = await countClosedPeriodsByVersion(db, input.restaurantId);
    expect(closed.get(v1)).toBe(1);
    expect(closed.get(history[0]?.id ?? '')).toBeUndefined();

    const view = await getDistributionConfigView(db, {
      restaurantId: input.restaurantId,
      canConfigure: true,
    });
    expect(view).toMatchObject({ source: 'database', venueName: 'Local de prueba', canEdit: true });
    expect(view?.current.number).toBe(2);
    expect(view?.current.values.rounding).toBe('PESO');
    expect(view?.versions.map((v) => [v.number, v.origin, v.closedPeriods])).toEqual([
      [2, 'CAMBIO', 0],
      [1, 'ESTANDAR', 1],
    ]);
  });

  it('renombrar un puesto no crea versión y el puesto sigue siendo el mismo', async () => {
    const { input, actor } = await setup();
    const salon = await positionId(input.restaurantId, 'Salón');
    await ok(renamePosition(db, actor, salon, 'Salón principal'));
    expect(
      await db.distributionPolicyVersion.count({ where: { restaurantId: input.restaurantId } }),
    ).toBe(1);
    const current = await getCurrentPolicy(db, input.restaurantId);
    expect(current?.positions.find((p) => p.positionId === salon)?.name).toBe('Salón principal');
    expect(await renamePosition(db, actor, salon, 'barra')).toEqual({
      ok: false,
      error: 'Ya existe el puesto "barra".',
    });
  });
});

describe('transacción', () => {
  it('si la transacción se revierte, no queda ni la versión, ni el puesto, ni el puntero', async () => {
    const { input, actor, v1 } = await setup();
    await expect(
      db.$transaction(async (tx) => {
        await ok(
          changePolicyInTx(tx, actor, { kind: 'addPosition', name: 'Cocina', factor: '0,015' }),
        );
        throw new Error('falla después de escribir');
      }, TX_OPTIONS),
    ).rejects.toThrow('falla después de escribir');

    const rid = input.restaurantId;
    expect(await db.distributionPolicyVersion.count({ where: { restaurantId: rid } })).toBe(1);
    expect(await db.position.count({ where: { restaurantId: rid } })).toBe(4);
    const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: rid } });
    expect(restaurant.currentPolicyVersionId).toBe(v1);
  });

  it('dos cambios simultáneos se ordenan (versiones 2 y 3, en cadena) sin chocar', async () => {
    const { input, actor } = await setup();
    const [a, b] = await Promise.all([
      changePolicy(db, actor, { kind: 'value', key: 'rounding', value: 'PESO' }),
      changePolicy(db, actor, { kind: 'addPosition', name: 'Cocina', factor: '0,015' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const history = await listPolicyVersions(db, input.restaurantId);
    expect(history.map((v) => v.number)).toEqual([3, 2, 1]);
    expect(history[0]?.previousVersionId).toBe(history[1]?.id);
    expect(history[1]?.previousVersionId).toBe(history[2]?.id);
    // La última versión tiene los dos cambios: ninguno pisó al otro.
    expect(history[0]?.values.rounding).toBe('PESO');
    expect(history[0]?.positions.some((p) => p.name === 'Cocina')).toBe(true);
  });
});

describe('períodos abiertos', () => {
  it('el período abierto pasa a la versión nueva con registro automático; uno reabierto conserva la suya', async () => {
    const { input, actor, v1 } = await setup();
    const rid = input.restaurantId;
    const open = randomUUID();
    const voided = randomUUID();
    const redo = randomUUID();
    await db.$transaction([
      // Semana abierta normal.
      db.$executeRaw`INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end,
          policy_version_id, created_by, updated_at)
        VALUES (${open}::uuid, ${rid}::uuid, '2026-09-21', '2026-09-27', ${v1}::uuid,
          ${actor.userId}::uuid, now())`,
      // Semana anterior: cerrada, anulada y reabierta como revisión 2.
      db.$executeRaw`INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end,
          policy_version_id, created_by, status, closed_at, closed_by, total_cents,
          total_advances_cents, total_final_cents, policy_snapshot, calc_version, updated_at)
        VALUES (${voided}::uuid, ${rid}::uuid, '2026-09-14', '2026-09-20', ${v1}::uuid,
          ${actor.userId}::uuid, 'CLOSED', now(), ${actor.userId}::uuid, 0, 0, 0, '{}'::jsonb,
          'provisional-1', now())`,
      db.$executeRaw`UPDATE weekly_settlements SET status = 'VOIDED', voided_at = now(),
          voided_by = ${actor.userId}::uuid, void_reason = 'cargué mal las horas'
        WHERE id = ${voided}::uuid`,
      db.$executeRaw`INSERT INTO weekly_settlements (id, restaurant_id, week_start, week_end,
          revision, supersedes_settlement_id, policy_version_id, created_by, updated_at)
        VALUES (${redo}::uuid, ${rid}::uuid, '2026-09-14', '2026-09-20', 2, ${voided}::uuid,
          ${v1}::uuid, ${actor.userId}::uuid, now())`,
    ]);

    const change = await ok(
      changePolicy(db, actor, { kind: 'value', key: 'rounding', value: 'PESO' }),
    );
    expect(change.movedPeriods).toEqual([open]);

    const periods = await db.weeklySettlement.findMany({
      where: { id: { in: [open, redo] } },
      select: { id: true, policyVersionId: true },
    });
    const versionOf = (id: string) => periods.find((p) => p.id === id)?.policyVersionId;
    expect(versionOf(open)).toBe(change.versionId);
    expect(versionOf(redo)).toBe(v1);

    const log = await db.periodPolicyChange.findMany({ where: { restaurantId: rid } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      settlementId: open,
      fromVersionId: v1,
      toVersionId: change.versionId,
      automatic: true,
      reason: null,
      performedById: actor.userId,
    });
  });
});

describe('restaurant scoping', () => {
  it('un restaurante no ve ni toca la política ni los puestos de otro', async () => {
    const a = await setup('Local A');
    const b = await setup('Local B');
    const salonB = await positionId(b.input.restaurantId, 'Salón');

    // Un puesto de B no existe para A.
    expect(
      await changePolicy(db, a.actor, { kind: 'portion', positionId: salonB, factor: '0,03' }),
    ).toEqual({ ok: false, error: 'Ese puesto no existe.' });
    expect(await renamePosition(db, a.actor, salonB, 'Robado')).toEqual({
      ok: false,
      error: 'Ese puesto no existe.',
    });
    // Una versión de B no existe para A.
    expect(await getPolicyVersion(db, a.input.restaurantId, b.v1)).toBeNull();

    await ok(changePolicy(db, a.actor, { kind: 'value', key: 'rounding', value: 'PESO' }));
    expect((await listPolicyVersions(db, a.input.restaurantId)).map((v) => v.number)).toEqual([
      2, 1,
    ]);
    expect((await listPolicyVersions(db, b.input.restaurantId)).map((v) => v.number)).toEqual([1]);
    expect((await getCurrentPolicy(db, b.input.restaurantId))?.values.rounding).toBe('CENTAVO');

    // Un operador sin membresía en B no obtiene acceso a B.
    await expect(
      resolveAccess(db, { restaurantId: b.input.restaurantId, email: a.input.operatorEmail }),
    ).rejects.toBeInstanceOf(AccessError);
    const access = await resolveAccess(db, {
      restaurantId: a.input.restaurantId,
      email: a.input.operatorEmail,
    });
    expect(access).toMatchObject({
      restaurantId: a.input.restaurantId,
      userId: a.actor.userId,
      role: 'OWNER',
      canConfigure: true,
    });
  });
});
