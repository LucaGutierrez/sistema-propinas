/**
 * Roles y quién puede qué (ARCHITECTURE.md §9). Funciones puras: sin base ni sesión.
 *
 *   OWNER    dueño del restaurante (uno solo): todo
 *   MANAGER  encargado: opera el local y configura la distribución
 *   EDITOR   carga la semana (horas, pozos); ve todo el local
 *   VIEWER   solo lectura de todo el local
 *   SELF     solo lo de su empleado vinculado (sus sobres)
 */
import type { MembershipRole } from '@prisma/client';

export type Role = MembershipRole;

export const ROLES: readonly Role[] = ['OWNER', 'MANAGER', 'EDITOR', 'VIEWER', 'SELF'];

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Dueño',
  MANAGER: 'Encargado',
  EDITOR: 'Editor',
  VIEWER: 'Lector',
  SELF: 'Solo lo propio',
};

/** Roles que ven los datos de todo el local (SELF solo ve los de su empleado). */
const WHOLE_RESTAURANT: readonly Role[] = ['OWNER', 'MANAGER', 'EDITOR', 'VIEWER'];

/** Roles permitidos por capacidad. Las pantallas y acciones piden una de estas listas. */
export const CAN = {
  /** Ver la configuración de distribución vigente y su historial. */
  viewDistributionConfig: WHOLE_RESTAURANT,
  /** Cambiar la configuración de distribución (crea una versión nueva). */
  editDistributionConfig: ['OWNER', 'MANAGER'],
  /** Ver datos de empleados: SELF solo el suyo (ver `employeeScope`). */
  viewEmployees: ['OWNER', 'MANAGER', 'EDITOR', 'VIEWER', 'SELF'],
  /** Pantalla "Personal": todo el equipo del local (SELF no: solo ve sus sobres). */
  viewStaff: WHOLE_RESTAURANT,
  /** Agregar personas, cambiar su puesto, darlas de baja o reactivarlas. */
  manageStaff: ['OWNER', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export function roleAllowed(role: Role, roles: readonly Role[]): boolean {
  return roles.includes(role);
}
