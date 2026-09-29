/**
 * Lecturas de "Personal". Todas filtran por `restaurantId` (nunca se lee un empleado solo por id).
 *
 * Nombre: la pantalla tiene un solo campo "Nombre". Se guarda completo en `employees.first_name`
 * (con `last_name` vacío) y se muestra uniendo ambos, así un empleado cargado con nombre y
 * apellido por separado también se ve bien.
 */
import { participationMethodOf } from '@/lib/policy/db-mapping';
import type { StaffView } from '@/lib/staff/view';
import { getCurrentPolicy, getRestaurant, type DbClient } from '../policy/repository';

/** Puntos individuales de la base (NUMERIC(6,2), sin floats) → "1,20". */
export function pointsText(value: { toFixed(n: number): string }): string {
  return value.toFixed(2).replace('.', ',');
}

export function displayName(employee: { firstName: string; lastName: string }): string {
  return [employee.firstName, employee.lastName]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
}

/** Empleados (no archivados) del restaurante, en orden de alta. */
export async function listEmployees(db: DbClient, restaurantId: string) {
  const rows = await db.employee.findMany({
    where: { restaurantId, archivedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      defaultPositionId: true,
      active: true,
      individualPoints: true,
    },
  });
  return rows.map((e) => ({
    id: e.id,
    name: displayName(e),
    positionId: e.defaultPositionId ?? '',
    active: e.active,
    individualPoints: pointsText(e.individualPoints),
  }));
}

/**
 * Pantalla "Personal" del restaurante: personas y puestos de la política VIGENTE (con la porción
 * de esa versión). null si el restaurante no existe o todavía no tiene política.
 */
export async function getStaffView(
  db: DbClient,
  access: { restaurantId: string; canEdit: boolean },
): Promise<StaffView | null> {
  const [restaurant, policy, members] = await Promise.all([
    getRestaurant(db, access.restaurantId),
    getCurrentPolicy(db, access.restaurantId),
    listEmployees(db, access.restaurantId),
  ]);
  if (!restaurant || !policy) return null;
  return {
    venueName: restaurant.name,
    policyVersion: policy.number,
    positions: policy.positions.map((p) => ({ id: p.positionId, name: p.name, factor: p.factor })),
    members,
    canEdit: access.canEdit,
    method: participationMethodOf(policy.columns.portionMode),
    portionDisplay: restaurant.portionDisplay,
  };
}
