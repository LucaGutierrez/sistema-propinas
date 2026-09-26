/**
 * Qué puede hacer cada permiso dentro de un local. Es la regla única que usa la interfaz;
 * con el login, el servidor aplicará exactamente estas mismas reglas.
 */
import type { DistributionConfig } from './config';
import type { Member, Role } from './model';

export interface Permissions {
  role: Role;
  /** Ver todo el local: semanas, pozos, sobres de todos, personal. */
  viewAll: boolean;
  /** Empezar semana y cargar pozos, horas y adelantos. */
  editWeek: boolean;
  closeWeek: boolean;
  /** Agregar personal, puestos, dar de baja. */
  manageStaff: boolean;
  /** Invitar y cambiar permisos. */
  manageAccess: boolean;
  /**
   * Preparar y entregar sobres. El Encargado siempre; el Editor, si la configuración del local
   * lo permite (`envelopes = ENCARGADO_Y_EDITOR`). Revertir es siempre solo del Encargado.
   */
  handleEnvelopes: boolean;
  /** Revertir una entrega (con motivo). Solo el Encargado. */
  revertDelivery: boolean;
  /** Cambiar la configuración de distribución del local. */
  configureDistribution: boolean;
  /** Para "Solo lo suyo": su ficha en el personal. */
  ownStaffId: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  ENCARGADO: 'Encargado',
  EDITOR: 'Editor',
  LECTOR: 'Solo ver',
  PROPIO: 'Solo lo suyo',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ENCARGADO: 'Todo: personal, puestos, cerrar la semana e invitar.',
  EDITOR: 'Carga pozos, horas y adelantos. No cierra la semana ni invita.',
  LECTOR: 'Ve todo el local, pero no modifica nada.',
  PROPIO: 'Ve solamente su propio sobre, sus horas y sus adelantos.',
};

export function permissionsFor(role: Role, ownStaffId: string | null = null): Permissions {
  switch (role) {
    case 'ENCARGADO':
      return {
        role,
        viewAll: true,
        editWeek: true,
        closeWeek: true,
        manageStaff: true,
        manageAccess: true,
        handleEnvelopes: true,
        revertDelivery: true,
        configureDistribution: true,
        ownStaffId,
      };
    case 'EDITOR':
      return {
        role,
        viewAll: true,
        editWeek: true,
        closeWeek: false,
        manageStaff: false,
        manageAccess: false,
        handleEnvelopes: false,
        revertDelivery: false,
        configureDistribution: false,
        ownStaffId,
      };
    case 'LECTOR':
      return {
        role,
        viewAll: true,
        editWeek: false,
        closeWeek: false,
        manageStaff: false,
        manageAccess: false,
        handleEnvelopes: false,
        revertDelivery: false,
        configureDistribution: false,
        ownStaffId,
      };
    case 'PROPIO':
      return {
        role,
        viewAll: false,
        editWeek: false,
        closeWeek: false,
        manageStaff: false,
        manageAccess: false,
        handleEnvelopes: false,
        revertDelivery: false,
        configureDistribution: false,
        ownStaffId,
      };
  }
}

/**
 * Permisos efectivos: los del miembro simulado, o los del encargado dueño de la cuenta.
 * Algunos dependen de la configuración del local (p. ej. si el Editor maneja sobres).
 */
export function effectivePermissions(
  viewAs: Member | null,
  config?: DistributionConfig,
): Permissions {
  const base = viewAs ? permissionsFor(viewAs.role, viewAs.staffId) : permissionsFor('ENCARGADO');
  if (base.role === 'EDITOR' && config?.envelopes === 'ENCARGADO_Y_EDITOR') {
    return { ...base, handleEnvelopes: true };
  }
  return base;
}
