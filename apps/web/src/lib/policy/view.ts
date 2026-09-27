/**
 * Lo que muestra "Configuración de distribución", sin saber de dónde viene (demo en el navegador
 * o base de datos). Cada fuente arma este modelo y ofrece las mismas acciones.
 */
import type { ParamKey } from '@/lib/demo-store/config';
import type { PolicyVersion } from '@/lib/demo-store/policy';

export interface PolicyVersionView extends PolicyVersion {
  /** Períodos cerrados que se calcularon con esta versión. */
  closedPeriods: number;
}

export interface DistributionConfigView {
  source: 'demo' | 'database';
  venueName: string;
  /** Versión vigente (la que toman los períodos nuevos). */
  current: PolicyVersionView;
  /** Todas las versiones, de la más nueva a la más vieja. */
  versions: PolicyVersionView[];
  /** Personas activas por puesto (id del puesto → cantidad). */
  peopleByPosition: Record<string, number>;
  canEdit: boolean;
}

/** Acciones de la pantalla. Devuelven el error a mostrar, o null si salió bien. */
export interface DistributionConfigActions {
  setValue(key: ParamKey, value: string): Promise<string | null>;
  addPosition(name: string, factor: string): Promise<string | null>;
  setPortion(positionId: string, factor: string): Promise<string | null>;
}
