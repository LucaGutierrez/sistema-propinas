/**
 * Autorización real: sesión (Better Auth) + membresía (nuestra tabla) + rol.
 *
 * `resolveAccess` es el núcleo (sin Next): recibe el usuario de la sesión, busca SU membresía en
 * el restaurante pedido y valida el rol. Nada de lo que decide viene del navegador: el usuario
 * sale de la sesión y el restaurante se verifica contra `memberships`.
 *
 * Fallas (siempre seguras, sin datos de otros restaurantes):
 *   UNAUTHENTICATED  sin sesión                       → ir al login
 *   NOT_FOUND        no es miembro / no existe / archivado / recurso ajeno → 404 (no revela nada)
 *   FORBIDDEN        es miembro pero su rol no alcanza → "sin permiso"
 */
import type { Db } from '../db';
import type { SessionUser } from '../auth/session';
import { roleAllowed, type Role } from './roles';

export type AccessFailure = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'FORBIDDEN';

const MESSAGES: Record<AccessFailure, string> = {
  UNAUTHENTICATED: 'Tenés que iniciar sesión.',
  NOT_FOUND: 'No se encontró el restaurante.',
  FORBIDDEN: 'Tu rol no tiene permiso para esta acción.',
};

export class AccessDenied extends Error {
  constructor(
    readonly reason: AccessFailure,
    message: string = MESSAGES[reason],
  ) {
    super(message);
    this.name = 'AccessDenied';
  }
}

/** Contexto tipado de un pedido autorizado. Los servicios reciben `restaurantId` y `userId` de acá. */
export interface AccessContext {
  restaurantId: string;
  restaurantName: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: Role;
  membershipId: string;
  /** Empleado vinculado (SELF siempre tiene uno). */
  employeeId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function resolveAccess(
  db: Db,
  user: SessionUser | null,
  input: { restaurantId: string; roles: readonly Role[] },
): Promise<AccessContext> {
  if (!user) throw new AccessDenied('UNAUTHENTICATED');
  if (!isUuid(input.restaurantId)) throw new AccessDenied('NOT_FOUND');

  const membership = await db.membership.findUnique({
    where: { userId_restaurantId: { userId: user.id, restaurantId: input.restaurantId } },
    select: {
      id: true,
      role: true,
      employeeId: true,
      restaurant: { select: { name: true, archivedAt: true } },
    },
  });
  if (!membership || membership.restaurant.archivedAt) throw new AccessDenied('NOT_FOUND');
  if (!roleAllowed(membership.role, input.roles)) throw new AccessDenied('FORBIDDEN');

  return {
    restaurantId: input.restaurantId,
    restaurantName: membership.restaurant.name,
    userId: user.id,
    // El nombre sale de la sesión (la misma fila de `users` que valida Better Auth).
    userName: user.name,
    userEmail: user.email,
    role: membership.role,
    membershipId: membership.id,
    employeeId: membership.employeeId,
  };
}

/**
 * Núcleo de `requireAccess` (sin Next, para poder probarlo): usuario de la sesión + restaurante
 * (el indicado, o el activo: `preferredRestaurantId` es solo la preferencia guardada en la cookie
 * y vale únicamente si el usuario es miembro) + rol.
 *
 * Sin `restaurantId` explícito, NOT_FOUND significa que el usuario no es miembro de ningún
 * restaurante (no hay recurso ajeno en juego).
 */
export async function authorize(
  db: Db,
  user: SessionUser | null,
  input: { restaurantId?: string; preferredRestaurantId?: string; roles: readonly Role[] },
): Promise<AccessContext> {
  if (!user) throw new AccessDenied('UNAUTHENTICATED');
  if (input.restaurantId !== undefined) {
    return resolveAccess(db, user, { restaurantId: input.restaurantId, roles: input.roles });
  }
  // Restaurante activo: una sola lectura de las membresías (elegir y validar a la vez).
  const memberships = await db.membership.findMany({
    where: { userId: user.id, restaurant: { archivedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { restaurantId: 'asc' }],
    select: {
      id: true,
      role: true,
      employeeId: true,
      restaurantId: true,
      restaurant: { select: { name: true } },
    },
  });
  const chosen =
    memberships.find((m) => m.restaurantId === input.preferredRestaurantId) ?? memberships[0];
  if (!chosen) {
    throw new AccessDenied('NOT_FOUND', 'Tu usuario todavía no tiene acceso a ningún restaurante.');
  }
  if (!roleAllowed(chosen.role, input.roles)) throw new AccessDenied('FORBIDDEN');
  return {
    restaurantId: chosen.restaurantId,
    restaurantName: chosen.restaurant.name,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: chosen.role,
    membershipId: chosen.id,
    employeeId: chosen.employeeId,
  };
}

/** Defensa en profundidad: un contexto ya resuelto, ¿alcanza para esta capacidad? */
export function assertRole(access: AccessContext, roles: readonly Role[]): void {
  if (!roleAllowed(access.role, roles)) throw new AccessDenied('FORBIDDEN');
}

/**
 * Filtro de empleados que este contexto puede ver: siempre del restaurante; SELF, solo el suyo.
 * Usarlo en TODA consulta de empleados (o de datos por empleado: sobres, horas, adelantos).
 */
export function employeeScope(access: AccessContext): { restaurantId: string; id?: string } {
  if (access.role === 'SELF') {
    // La base garantiza que SELF tiene empleado (ck_memberships_self_employee); si faltara, nada.
    if (!access.employeeId) throw new AccessDenied('FORBIDDEN');
    return { restaurantId: access.restaurantId, id: access.employeeId };
  }
  return { restaurantId: access.restaurantId };
}

/** Un recurso de un empleado ajeno (otro restaurante, u otro empleado para SELF) es 404. */
export function assertEmployeeInScope(
  access: AccessContext,
  employee: { id: string; restaurantId: string },
): void {
  const scope = employeeScope(access);
  if (
    employee.restaurantId !== scope.restaurantId ||
    (scope.id !== undefined && employee.id !== scope.id)
  ) {
    throw new AccessDenied('NOT_FOUND', 'No se encontró el empleado.');
  }
}

export interface UserRestaurant {
  restaurantId: string;
  name: string;
  role: Role;
}

/** Restaurantes (no archivados) de los que el usuario es miembro, en orden de alta. */
export async function listUserRestaurants(db: Db, userId: string): Promise<UserRestaurant[]> {
  const rows = await db.membership.findMany({
    where: { userId, restaurant: { archivedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { restaurantId: 'asc' }],
    select: { role: true, restaurantId: true, restaurant: { select: { name: true } } },
  });
  return rows.map((r) => ({ restaurantId: r.restaurantId, name: r.restaurant.name, role: r.role }));
}

/**
 * Restaurante activo: el elegido (si el usuario es miembro) o, si no, el primero de los suyos.
 * `requested` es solo una preferencia (cookie): nunca da acceso por sí misma.
 */
export async function pickActiveRestaurant(
  db: Db,
  userId: string,
  requested: string | undefined,
): Promise<string | null> {
  const restaurants = await listUserRestaurants(db, userId);
  const chosen = restaurants.find((r) => r.restaurantId === requested);
  return (chosen ?? restaurants[0])?.restaurantId ?? null;
}
