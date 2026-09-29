/**
 * Lo que muestra "Personal", sin saber de dónde viene (demo en el navegador o base de datos).
 * Cada fuente arma este modelo y ofrece las mismas acciones.
 */
import type { ParticipationMethod } from '@/lib/distribution/participation';
import type { PortionDisplay } from '@/lib/policy/portion-format';

/** Puesto de la política vigente, con su porción (la porción es de la versión, no del puesto). */
export interface StaffPositionView {
  id: string;
  name: string;
  /** Porción como se muestra: "0,022". */
  factor: string;
}

export interface StaffMemberView {
  id: string;
  name: string;
  /** Puesto (identidad estable). Vacío si la persona no tiene puesto asignado. */
  positionId: string;
  active: boolean;
  /** Puntos individuales ("1,20"). Solo los tiene la base (la demo no). */
  individualPoints?: string;
}

export interface StaffView {
  venueName: string;
  /** Número de la versión vigente de la política. */
  policyVersion: number;
  /** Puestos de la versión vigente, en su orden. */
  positions: StaffPositionView[];
  /** Todas las personas (activas y de baja), en orden de alta. */
  members: StaffMemberView[];
  canEdit: boolean;
  /** Método de participación de la política vigente (decide si los puntos intervienen). */
  method?: ParticipationMethod;
  /** Cómo se muestran las porciones (por defecto, decimal). */
  portionDisplay?: PortionDisplay;
}

/** Acciones de la pantalla. Devuelven el error a mostrar, o null si salió bien. */
export interface StaffActions {
  add(name: string, positionId: string): Promise<string | null>;
  setPosition(memberId: string, positionId: string): Promise<string | null>;
  setActive(memberId: string, active: boolean): Promise<string | null>;
  /** Cambia los puntos individuales. Sin esta acción (demo) no se pueden editar. */
  setPoints?(memberId: string, points: string): Promise<string | null>;
}
