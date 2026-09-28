/**
 * Lo que muestra "Personal", sin saber de dónde viene (demo en el navegador o base de datos).
 * Cada fuente arma este modelo y ofrece las mismas acciones.
 */

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
}

/** Acciones de la pantalla. Devuelven el error a mostrar, o null si salió bien. */
export interface StaffActions {
  add(name: string, positionId: string): Promise<string | null>;
  setPosition(memberId: string, positionId: string): Promise<string | null>;
  setActive(memberId: string, active: boolean): Promise<string | null>;
}
