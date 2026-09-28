/**
 * Escrituras de "Personal" sobre un contexto YA autorizado por `requireAccess`.
 *
 * - Cada operación vuelve a comprobar el rol (defensa en profundidad) y opera solo sobre
 *   `access.restaurantId`: un id de otro restaurante es "no existe", sin revelar nada.
 * - El puesto de una persona es la identidad estable (`positions.id`) y tiene que ser un puesto de
 *   la política VIGENTE del restaurante. Cambiar el puesto de alguien no crea una versión de la
 *   política; cambiar la porción de un puesto (en Configuración) no toca a las personas.
 * - Cada operación es UNA transacción que bloquea el restaurante (`FOR UPDATE`), igual que la
 *   política: dos altas simultáneas con el mismo nombre se ordenan y la segunda se rechaza.
 */
import type { PrismaClient } from '@prisma/client';
import { assertRole, type AccessContext } from '../access/access';
import { CAN } from '../access/roles';
import { getCurrentPolicy, type DbClient } from '../policy/repository';
import { TX_OPTIONS, type ServiceResult } from '../policy/service';
import { displayName } from './repository';
import type { AddStaffInput, SetStaffActiveInput, SetStaffPositionInput } from './schemas';

const fail = <T>(error: string): ServiceResult<T> => ({ ok: false, error });

const NOT_FOUND = 'Esa persona no existe.';

async function lockRestaurant(tx: DbClient, restaurantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM restaurants WHERE id = ${restaurantId}::uuid FOR UPDATE`;
  return rows.length === 1;
}

/** ¿El puesto es de la política vigente de este restaurante? */
async function isCurrentPosition(
  tx: DbClient,
  restaurantId: string,
  positionId: string,
): Promise<boolean> {
  const policy = await getCurrentPolicy(tx, restaurantId);
  return policy?.positions.some((p) => p.positionId === positionId) ?? false;
}

/** ¿Hay otra persona activa con ese nombre (sin distinguir mayúsculas)? */
async function activeNameTaken(
  tx: DbClient,
  restaurantId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const active = await tx.employee.findMany({
    where: {
      restaurantId,
      active: true,
      archivedAt: null,
      id: exceptId ? { not: exceptId } : undefined,
    },
    select: { firstName: true, lastName: true },
  });
  const wanted = name.toLowerCase();
  return active.some((e) => displayName(e).toLowerCase() === wanted);
}

export async function addEmployee(
  db: PrismaClient,
  access: AccessContext,
  input: AddStaffInput,
): Promise<ServiceResult<{ employeeId: string }>> {
  assertRole(access, CAN.manageStaff);
  const name = input.name.trim();
  return db.$transaction(async (tx) => {
    if (!(await lockRestaurant(tx, access.restaurantId))) return fail('El restaurante no existe.');
    if (!(await isCurrentPosition(tx, access.restaurantId, input.positionId))) {
      return fail('Elegí un puesto.');
    }
    if (await activeNameTaken(tx, access.restaurantId, name)) {
      return fail(`Ya hay alguien activo llamado "${name}".`);
    }
    const employee = await tx.employee.create({
      data: {
        restaurantId: access.restaurantId,
        firstName: name,
        lastName: '',
        defaultPositionId: input.positionId,
      },
      select: { id: true },
    });
    return { ok: true, value: { employeeId: employee.id } };
  }, TX_OPTIONS);
}

export async function setEmployeePosition(
  db: PrismaClient,
  access: AccessContext,
  input: SetStaffPositionInput,
): Promise<ServiceResult<{ employeeId: string }>> {
  assertRole(access, CAN.manageStaff);
  return db.$transaction(async (tx) => {
    if (!(await lockRestaurant(tx, access.restaurantId))) return fail('El restaurante no existe.');
    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, restaurantId: access.restaurantId, archivedAt: null },
      select: { id: true, active: true },
    });
    if (!employee) return fail(NOT_FOUND);
    if (!employee.active) return fail('Reactivá a la persona antes de cambiar su puesto.');
    if (!(await isCurrentPosition(tx, access.restaurantId, input.positionId))) {
      return fail('Ese puesto no existe.');
    }
    await tx.employee.update({
      where: { id: employee.id },
      data: { defaultPositionId: input.positionId },
    });
    return { ok: true, value: { employeeId: employee.id } };
  }, TX_OPTIONS);
}

export async function setEmployeeActive(
  db: PrismaClient,
  access: AccessContext,
  input: SetStaffActiveInput,
): Promise<ServiceResult<{ employeeId: string }>> {
  assertRole(access, CAN.manageStaff);
  return db.$transaction(async (tx) => {
    if (!(await lockRestaurant(tx, access.restaurantId))) return fail('El restaurante no existe.');
    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, restaurantId: access.restaurantId, archivedAt: null },
      select: { id: true, firstName: true, lastName: true, active: true },
    });
    if (!employee) return fail(NOT_FOUND);
    if (employee.active === input.active) return { ok: true, value: { employeeId: employee.id } };
    if (input.active) {
      const name = displayName(employee);
      if (await activeNameTaken(tx, access.restaurantId, name, employee.id)) {
        return fail(`Ya hay alguien activo llamado "${name}".`);
      }
    }
    await tx.employee.update({ where: { id: employee.id }, data: { active: input.active } });
    return { ok: true, value: { employeeId: employee.id } };
  }, TX_OPTIONS);
}
