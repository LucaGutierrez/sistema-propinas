/**
 * Configuración estándar de GUTIP (CONFIG-MODEL.md): vive en el código y cada versión que sale de
 * ella registra `template_code` / `template_version` en la base. Es la misma que usa la demo
 * (valores de `STANDARD_VALUES` y los puestos estándar), así las dos nacen iguales.
 */
import { STANDARD_VALUES, type DistributionConfig } from '@/lib/demo-store/config';
import { SEED_POSITIONS } from '@/lib/demo/data';

export interface PolicyTemplate {
  code: string;
  version: number;
  label: string;
  values: DistributionConfig;
  /** Día de inicio del período (1 = lunes … 7 = domingo). El estándar es lunes; no es una regla. */
  periodStartWeekday: number;
  positions: readonly { name: string; factor: string }[];
}

export const STANDARD_TEMPLATE: PolicyTemplate = {
  code: 'gutip-standard',
  version: 1,
  label: 'Configuración estándar de GUTIP (v1)',
  values: STANDARD_VALUES,
  periodStartWeekday: 1,
  positions: SEED_POSITIONS.map(({ name, factor }) => ({ name, factor })),
};
