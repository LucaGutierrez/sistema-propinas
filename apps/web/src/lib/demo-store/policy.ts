/**
 * Política de distribución versionada de cada local (CONFIG-MODEL.md).
 *
 *   POLÍTICA → define cómo se calcula (parámetros + puestos con su peso)
 *   PERSONAL → quiénes trabajan y en qué puesto (NO es parte de la política)
 *   PERÍODO  → datos variables (pozos, horas, adelantos) + la versión fijada
 *   MOTOR    → calcula con política + personal + datos del período
 *   CIERRE   → congela todo (snapshot)
 *
 * Una versión nunca se edita: cambiar la política crea una versión nueva. Un local nace con la
 * configuración estándar de GUTIP (válida: puede calcular y cerrar) o con una copia de otra
 * política. "Por definir" solo aparece cuando una personalización deja algo incompleto.
 */
import { parseDecimal } from '@/lib/decimal';
import { SEED_POSITIONS } from '@/lib/demo/data';
import { FACTOR_SCALE } from '@/lib/distribution/provisional-formula';
import { checkStages } from '@/lib/distribution/sector-stages';
import {
  PARAMS,
  STANDARD_VALUES,
  isSupported,
  normalizeValues,
  type DistributionConfig,
  type ParamKey,
} from './config';
import type { Position } from './model';

export const STANDARD_LABEL = 'Configuración estándar de GUTIP (v1)';

export type PolicyOrigin = 'ESTANDAR' | 'COPIA' | 'CAMBIO';

export interface PolicyVersion {
  number: number;
  createdAt: string;
  createdBy: string;
  origin: PolicyOrigin;
  /** Qué cambió (se genera solo): "Redondeo: Centavos → Pesos enteros". */
  summary: string;
  values: DistributionConfig;
  /** Puestos con su peso: son parte de la política porque definen el cálculo. */
  positions: Position[];
}

export interface VenuePolicy {
  /** Número de la versión vigente: la que toman los períodos nuevos. */
  current: number;
  versions: PolicyVersion[];
}

/** Puestos de la configuración estándar (los que usa la demo desde el principio). */
export function standardPositions(): Position[] {
  return SEED_POSITIONS.map((p) => ({ ...p }));
}

export function standardPolicy(at: string): VenuePolicy {
  return {
    current: 1,
    versions: [
      {
        number: 1,
        createdAt: at,
        createdBy: 'GUTIP',
        origin: 'ESTANDAR',
        summary: STANDARD_LABEL,
        values: { ...STANDARD_VALUES },
        positions: standardPositions(),
      },
    ],
  };
}

/** Política nueva e independiente copiada de otra (p. ej. de otro local). */
export function copiedPolicy(
  source: PolicyVersion,
  sourceName: string,
  by: string,
  at: string,
): VenuePolicy {
  return {
    current: 1,
    versions: [
      {
        number: 1,
        createdAt: at,
        createdBy: by,
        origin: 'COPIA',
        summary: `Copia de la política de ${sourceName} (versión ${source.number})`,
        values: { ...source.values },
        positions: source.positions.map((p) => ({ ...p })),
      },
    ],
  };
}

export function versionOf(policy: VenuePolicy, number: number): PolicyVersion | undefined {
  return policy.versions.find((v) => v.number === number);
}

export function currentVersion(policy: VenuePolicy): PolicyVersion {
  const version = versionOf(policy, policy.current) ?? policy.versions[policy.versions.length - 1];
  if (!version) throw new Error('La política no tiene versiones.');
  return version;
}

/** Agrega una versión nueva (número siguiente) y la deja vigente. */
export function appendVersion(
  policy: VenuePolicy,
  next: Omit<PolicyVersion, 'number'>,
): { policy: VenuePolicy; version: PolicyVersion } {
  const number = Math.max(0, ...policy.versions.map((v) => v.number)) + 1;
  const version: PolicyVersion = { ...next, number };
  return { policy: { current: number, versions: [...policy.versions, version] }, version };
}

/** ¿Este parámetro sigue en el valor estándar o el local lo personalizó? */
export function paramOrigin(version: PolicyVersion, key: ParamKey): 'ESTANDAR' | 'PERSONALIZADO' {
  return version.values[key] === STANDARD_VALUES[key] ? 'ESTANDAR' : 'PERSONALIZADO';
}

/** ¿Los puestos difieren de los estándar (nombres o pesos)? */
export function positionsCustomized(version: PolicyVersion): boolean {
  const key = (list: readonly Position[]) =>
    list
      .map((p) => `${p.name.toLowerCase()}=${parseDecimal(p.factor, FACTOR_SCALE) ?? p.factor}`)
      .sort()
      .join('|');
  return key(version.positions) !== key(SEED_POSITIONS);
}

/**
 * Lo que falta definir para poder CERRAR con esta versión. Vacío = completa.
 * La configuración estándar nunca tiene faltantes; solo una personalización incompleta.
 * (Con las opciones implementadas hoy, lo único que puede faltar son los puestos.)
 */
export function policyGaps(version: PolicyVersion): string[] {
  const gaps: string[] = [];
  for (const param of PARAMS) {
    if (!isSupported(param.key, version.values[param.key])) {
      gaps.push(`${param.label}: la opción elegida todavía no la calcula GUTIP.`);
    }
  }
  if (version.positions.length === 0) {
    gaps.push('Puestos: definí al menos un puesto con su porción.');
  }
  for (const position of version.positions) {
    const factor = parseDecimal(position.factor, FACTOR_SCALE);
    if (factor === null || factor === 0n) {
      gaps.push(`Puesto ${position.name}: falta una porción válida (mayor que cero).`);
    }
  }
  if (version.values.groups === 'PORCENTAJE_POR_GRUPO' && version.positions.length > 0) {
    const check = checkStages(
      version.positions.map((p) => ({
        id: p.id,
        name: p.name,
        stage: p.stage ?? null,
        percent: p.stagePercent ?? null,
      })),
    );
    if (!check.ok) gaps.push(...check.errors.map((e) => `Reparto por sectores: ${e}`));
  }
  return gaps;
}

/**
 * Lee la política guardada. Los locales guardados antes de las versiones tenían `positions` y
 * `config` sueltos: se convierten en la versión 1 sin cambiar ningún valor.
 */
export function normalizePolicy(raw: {
  policy?: unknown;
  positions?: unknown;
  config?: unknown;
}): VenuePolicy {
  const stored = raw.policy as Partial<VenuePolicy> | undefined;
  if (stored && Array.isArray(stored.versions) && stored.versions.length > 0) {
    const versions = stored.versions.map((v) => ({
      ...v,
      values: normalizeValues(v.values),
      positions: Array.isArray(v.positions) ? v.positions : [],
    }));
    const current =
      typeof stored.current === 'number' && versions.some((v) => v.number === stored.current)
        ? stored.current
        : Math.max(...versions.map((v) => v.number));
    return { current, versions };
  }

  // Formato anterior: `config: { values, status }` y `positions`.
  const legacyConfig = raw.config as { values?: unknown } | undefined;
  const values = normalizeValues(legacyConfig?.values);
  const positions = Array.isArray(raw.positions) ? (raw.positions as Position[]) : [];
  const version: PolicyVersion = {
    number: 1,
    createdAt: '',
    createdBy: 'GUTIP',
    origin: 'ESTANDAR',
    summary: 'Política convertida desde los datos guardados antes de las versiones',
    values,
    positions,
  };
  return { current: 1, versions: [version] };
}
