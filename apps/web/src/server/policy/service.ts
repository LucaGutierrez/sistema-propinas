/**
 * Escrituras de la política de distribución (CONFIG-MODEL.md, DATABASE.md §4.2b y §6).
 *
 * - Una versión NUNCA se modifica: cada cambio inserta una versión nueva (número siguiente,
 *   `previous_version_id`, resumen, autor) con TODOS sus puestos y porciones, y la deja vigente.
 * - El período abierto pasa a la versión nueva con un registro automático en
 *   `period_policy_changes`; un período reabierto (una revisión que reemplaza a otra) conserva
 *   su versión (cambiarla es una acción explícita con motivo, fuera de esta etapa).
 * - Los puestos son identidades estables (`positions`); su porción vive en cada versión
 *   (`policy_version_positions`). Renombrar un puesto no crea versión.
 *
 * Cada operación es UNA transacción que empieza bloqueando el restaurante (`FOR UPDATE`): dos
 * cambios simultáneos se ordenan y ninguno pisa al otro. Las reglas de validación y los
 * mensajes son los mismos que la demo (`@/lib/policy/changes`).
 */
import type { PrismaClient } from '@prisma/client';
import type { ParamKey } from '@/lib/demo-store/config';
import {
  planAddPosition,
  planConfigValue,
  planPortionChange,
  type PolicyChangePlan,
  type PolicyDraft,
} from '@/lib/policy/changes';
import { portionToDb, valuesToColumns } from '@/lib/policy/db-mapping';
import { STANDARD_TEMPLATE, type PolicyTemplate } from '@/lib/policy/standard';
import { getPolicyVersion, type DbClient, type PolicyVersionRecord } from './repository';

/** Quién opera y sobre qué restaurante (hoy desde `server/context.ts`; luego `requireAccess`). */
export interface Actor {
  restaurantId: string;
  userId: string;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type PolicyChangeRequest =
  | { kind: 'value'; key: ParamKey; value: string }
  | { kind: 'addPosition'; name: string; factor: string }
  | { kind: 'portion'; positionId: string; factor: string };

export interface PolicyChangeResult {
  versionId: string;
  number: number;
  summary: string;
  /** Períodos abiertos que pasaron a la versión nueva (registro automático). */
  movedPeriods: string[];
}

/** Opciones de las transacciones interactivas: Neon puede tardar más que los 5 s por defecto. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Marca de un puesto nuevo en el borrador, antes de tener su id en la base. */
const NEW_POSITION = 'nuevo-puesto';

const fail = <T>(error: string): ServiceResult<T> => ({ ok: false, error });

/** Bloquea el restaurante hasta el fin de la transacción y devuelve su versión vigente. */
async function lockRestaurant(
  tx: DbClient,
  restaurantId: string,
): Promise<{ currentPolicyVersionId: string | null } | null> {
  const rows = await tx.$queryRaw<{ current_policy_version_id: string | null }[]>`
    SELECT current_policy_version_id::text AS current_policy_version_id
    FROM restaurants WHERE id = ${restaurantId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? { currentPolicyVersionId: row.current_policy_version_id } : null;
}

/** Id del puesto del restaurante con ese nombre (sin distinguir mayúsculas), o uno nuevo. */
async function positionIdFor(tx: DbClient, restaurantId: string, name: string): Promise<string> {
  const existing = await tx.position.findFirst({
    where: { restaurantId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.position.create({
    data: { restaurantId, name },
    select: { id: true },
  });
  return created.id;
}

/** Inserta los puestos de una versión (en la misma transacción que la crea: lo exige la base). */
async function insertVersionPositions(
  tx: DbClient,
  versionId: string,
  positions: readonly { positionId: string; portion: string }[],
): Promise<void> {
  await tx.policyVersionPosition.createMany({
    data: positions.map((p, index) => ({
      versionId,
      positionId: p.positionId,
      portion: p.portion,
      sortOrder: index,
    })),
  });
}

function draftOf(version: PolicyVersionRecord): PolicyDraft {
  return {
    values: version.values,
    positions: version.positions.map((p) => ({ id: p.positionId, name: p.name, factor: p.factor })),
  };
}

function plan(current: PolicyVersionRecord, request: PolicyChangeRequest): PolicyChangePlan {
  const draft = draftOf(current);
  switch (request.kind) {
    case 'value':
      return planConfigValue(draft, request.key, request.value);
    case 'addPosition':
      return planAddPosition(draft, {
        id: NEW_POSITION,
        name: request.name,
        factor: request.factor,
      });
    case 'portion':
      return planPortionChange(draft, request.positionId, request.factor);
  }
}

/**
 * Cambia la política dentro de una transacción ya abierta (`tx`). Todo lo que escribe pasa por
 * `tx`: si la transacción se revierte, no queda nada.
 */
export async function changePolicyInTx(
  tx: DbClient,
  actor: Actor,
  request: PolicyChangeRequest,
): Promise<ServiceResult<PolicyChangeResult>> {
  const restaurant = await lockRestaurant(tx, actor.restaurantId);
  if (!restaurant) return fail('El restaurante no existe.');
  if (!restaurant.currentPolicyVersionId) return fail('El restaurante todavía no tiene política.');
  const current = await getPolicyVersion(tx, actor.restaurantId, restaurant.currentPolicyVersionId);
  if (!current) return fail('No se encontró la versión vigente de la política.');

  const result = plan(current, request);
  if (!result.ok) return result;

  // Puestos de la versión nueva: los que no cambian conservan su porción exacta de la base.
  const exact = new Map(current.positions.map((p) => [p.positionId, p]));
  const positions: { positionId: string; portion: string }[] = [];
  for (const p of result.draft.positions) {
    const previous = exact.get(p.id);
    if (p.id === NEW_POSITION) {
      positions.push({
        positionId: await positionIdFor(tx, actor.restaurantId, p.name),
        portion: portionToDb(p.factor),
      });
    } else if (previous && previous.factor === p.factor) {
      positions.push({ positionId: p.id, portion: previous.portion });
    } else {
      positions.push({ positionId: p.id, portion: portionToDb(p.factor) });
    }
  }

  const last = await tx.distributionPolicyVersion.aggregate({
    where: { restaurantId: actor.restaurantId },
    _max: { number: true },
  });
  const number = (last._max.number ?? 0) + 1;

  const version = await tx.distributionPolicyVersion.create({
    data: {
      restaurantId: actor.restaurantId,
      number,
      origin: 'CHANGE',
      previousVersionId: current.id,
      summary: result.summary,
      ...valuesToColumns(result.draft.values, current.columns.periodStartWeekday),
      createdById: actor.userId,
    },
    select: { id: true },
  });
  await insertVersionPositions(tx, version.id, positions);
  await tx.restaurant.update({
    where: { id: actor.restaurantId },
    data: { currentPolicyVersionId: version.id },
  });

  // El período abierto pasa a la versión nueva; uno reabierto (reemplaza a otro) conserva la suya.
  const open = await tx.weeklySettlement.findMany({
    where: { restaurantId: actor.restaurantId, status: 'OPEN', supersedesSettlementId: null },
    select: { id: true, policyVersionId: true },
  });
  for (const period of open) {
    await tx.periodPolicyChange.create({
      data: {
        restaurantId: actor.restaurantId,
        settlementId: period.id,
        fromVersionId: period.policyVersionId,
        toVersionId: version.id,
        automatic: true,
        performedById: actor.userId,
      },
    });
    await tx.weeklySettlement.update({
      where: { id: period.id },
      data: { policyVersionId: version.id },
    });
  }

  return {
    ok: true,
    value: {
      versionId: version.id,
      number,
      summary: result.summary,
      movedPeriods: open.map((p) => p.id),
    },
  };
}

/** Cambia la política en una transacción propia. */
export function changePolicy(
  db: PrismaClient,
  actor: Actor,
  request: PolicyChangeRequest,
): Promise<ServiceResult<PolicyChangeResult>> {
  return db.$transaction((tx) => changePolicyInTx(tx, actor, request), TX_OPTIONS);
}

/** Renombra un puesto. NO crea versión: el nombre es del puesto, no de la política. */
export async function renamePosition(
  db: PrismaClient,
  actor: Actor,
  positionId: string,
  name: string,
): Promise<ServiceResult<{ positionId: string; name: string }>> {
  const next = name.trim();
  if (next === '') return fail('Poné un nombre para el puesto.');
  return db.$transaction(async (tx) => {
    const position = await tx.position.findFirst({
      where: { id: positionId, restaurantId: actor.restaurantId },
      select: { id: true },
    });
    if (!position) return fail('Ese puesto no existe.');
    const clash = await tx.position.findFirst({
      where: {
        restaurantId: actor.restaurantId,
        id: { not: positionId },
        name: { equals: next, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (clash) return fail(`Ya existe el puesto "${next}".`);
    await tx.position.update({ where: { id: positionId }, data: { name: next } });
    return { ok: true, value: { positionId, name: next } };
  }, TX_OPTIONS);
}

/**
 * Crea la versión 1 de la política a partir de una plantilla del código (hoy, la estándar),
 * con sus puestos, y la deja vigente. El restaurante no puede tener política todavía.
 */
export async function createTemplatePolicyInTx(
  tx: DbClient,
  actor: Actor,
  template: PolicyTemplate = STANDARD_TEMPLATE,
): Promise<ServiceResult<{ versionId: string }>> {
  const restaurant = await lockRestaurant(tx, actor.restaurantId);
  if (!restaurant) return fail('El restaurante no existe.');
  if (restaurant.currentPolicyVersionId) return fail('El restaurante ya tiene política.');
  const existing = await tx.distributionPolicyVersion.count({
    where: { restaurantId: actor.restaurantId },
  });
  if (existing > 0) {
    return fail('El restaurante tiene versiones de política pero ninguna vigente: revisar a mano.');
  }

  const positions: { positionId: string; portion: string }[] = [];
  for (const p of template.positions) {
    positions.push({
      positionId: await positionIdFor(tx, actor.restaurantId, p.name),
      portion: portionToDb(p.factor),
    });
  }
  const version = await tx.distributionPolicyVersion.create({
    data: {
      restaurantId: actor.restaurantId,
      number: 1,
      origin: 'STANDARD',
      templateCode: template.code,
      templateVersion: template.version,
      summary: template.label,
      ...valuesToColumns(template.values, template.periodStartWeekday),
      createdById: actor.userId,
    },
    select: { id: true },
  });
  await insertVersionPositions(tx, version.id, positions);
  await tx.restaurant.update({
    where: { id: actor.restaurantId },
    data: { currentPolicyVersionId: version.id },
  });
  return { ok: true, value: { versionId: version.id } };
}

export interface BootstrapInput {
  restaurantId: string;
  restaurantName: string;
  operatorEmail: string;
  operatorName: string;
}

export interface BootstrapResult {
  restaurantId: string;
  userId: string;
  versionId: string;
  created: { user: boolean; restaurant: boolean; membership: boolean; policy: boolean };
}

/** Falla de negocio dentro del bootstrap: se lanza para que Prisma revierta la transacción. */
class BootstrapAborted extends Error {}

/**
 * Inicializa un restaurante de desarrollo: operador (usuario + membresía OWNER), restaurante y
 * política estándar v1 con sus puestos. IDEMPOTENTE: lo que ya existe no se toca ni se duplica
 * (volver a correrlo no crea nada). No crea personal ni datos de períodos.
 *
 * TODO O NADA: una transacción interactiva de Prisma solo se revierte si algo se lanza, así que
 * una política que no se puede crear se lanza (y se devuelve como error fuera de la transacción)
 * en vez de devolverse adentro, donde quedarían el usuario, el restaurante y la membresía.
 */
export async function bootstrapRestaurant(
  db: PrismaClient,
  input: BootstrapInput,
  template: PolicyTemplate = STANDARD_TEMPLATE,
): Promise<ServiceResult<BootstrapResult>> {
  const email = input.operatorEmail.trim().toLowerCase();
  const restaurantName = input.restaurantName.trim();
  const operatorName = input.operatorName.trim();
  if (!email.includes('@')) return fail('El email del operador no es válido.');
  if (restaurantName === '' || operatorName === '') return fail('Faltan nombres.');

  try {
    return await db.$transaction(async (tx) => {
      const created = { user: false, restaurant: false, membership: false, policy: false };

      let user = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) {
        user = await tx.user.create({ data: { email, name: operatorName }, select: { id: true } });
        created.user = true;
      }

      const restaurant = await tx.restaurant.findUnique({
        where: { id: input.restaurantId },
        select: { id: true },
      });
      if (!restaurant) {
        await tx.restaurant.create({ data: { id: input.restaurantId, name: restaurantName } });
        created.restaurant = true;
      }

      const membership = await tx.membership.findUnique({
        where: { userId_restaurantId: { userId: user.id, restaurantId: input.restaurantId } },
        select: { id: true },
      });
      if (!membership) {
        await tx.membership.create({
          data: { userId: user.id, restaurantId: input.restaurantId, role: 'OWNER' },
        });
        created.membership = true;
      }

      const actor = { restaurantId: input.restaurantId, userId: user.id };
      const locked = await lockRestaurant(tx, input.restaurantId);
      let versionId = locked?.currentPolicyVersionId ?? null;
      if (!versionId) {
        const policy = await createTemplatePolicyInTx(tx, actor, template);
        if (!policy.ok) throw new BootstrapAborted(policy.error);
        versionId = policy.value.versionId;
        created.policy = true;
      }

      return {
        ok: true,
        value: { restaurantId: input.restaurantId, userId: user.id, versionId, created },
      };
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof BootstrapAborted) return fail(error.message);
    throw error;
  }
}
