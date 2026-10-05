/**
 * Cambios a la política de distribución (CONFIG-MODEL.md), como funciones puras: validan el
 * cambio sobre la versión vigente y devuelven el borrador de la versión nueva y su resumen.
 * No guardan nada: la demo (`demo-store/policy-ops.ts`) y el servicio de base de datos
 * (`server/policy/service.ts`) aplican el resultado cada uno a su almacenamiento, así las
 * reglas y los mensajes son los mismos en los dos.
 */
import { formatScaled, parseDecimal } from '@/lib/decimal';
import {
  isSupported,
  optionLabel,
  paramDefinition,
  type DistributionConfig,
  type ParamKey,
} from '@/lib/demo-store/config';
import { FACTOR_SCALE } from '@/lib/distribution/provisional-formula';
import {
  checkSectors,
  formatSectorPercent,
  parseSectorPercent,
  sectorInputs,
  sectorsSummary,
  type PolicySector,
  type SectorBase,
} from '@/lib/distribution/sector-steps';

/** Un puesto dentro de una versión: identidad estable (`id`), nombre y porción ("0,022"). */
export interface PolicyPosition {
  id: string;
  name: string;
  factor: string;
  /** Formato anterior del reparto por sectores: etapa del puesto; null/ausente = sin asignar. */
  stage?: number | null;
  /** Formato anterior: porcentaje de su etapa ("30", "12,5"); null/ausente = sin cargar. */
  stagePercent?: string | null;
  /** Reparto por sectores: id del sector (de `PolicyDraft.sectors`) en el que cobra. */
  sectorId?: string | null;
}

/** Valor de `groups` que reparte por sectores. */
export const STAGED_GROUPS = 'PORCENTAJE_POR_GRUPO';

/** Lo que define una versión de la política (sin número, autor ni fecha). */
export interface PolicyDraft {
  values: DistributionConfig;
  positions: PolicyPosition[];
  /** Reparto por sectores: sectores en orden. Ausente o vacío = sin sectores propios. */
  sectors?: PolicySector[];
}

export type PolicyChangePlan =
  { ok: true; draft: PolicyDraft; summary: string } | { ok: false; error: string };

const fail = (error: string): PolicyChangePlan => ({ ok: false, error });

/** Error de validación de la porción que escribe el usuario, o null si es válida. */
export function portionInputError(factor: string): string | null {
  const factorE4 = parseDecimal(factor, FACTOR_SCALE);
  return factorE4 === null || factorE4 === 0n
    ? 'La porción tiene que ser un número mayor que cero (hasta 4 decimales).'
    : null;
}

/** Normaliza la porción escrita para mostrarla igual en todos lados ("0.022" → "0,022"). */
export function displayPortion(factor: string): string {
  const factorE4 = parseDecimal(factor, FACTOR_SCALE) ?? 0n;
  return formatScaled(factorE4, FACTOR_SCALE, FACTOR_SCALE).replace(/0+$/, '').replace(/,$/, '');
}

export function planConfigValue(
  current: PolicyDraft,
  key: ParamKey,
  value: string,
): PolicyChangePlan {
  const definition = paramDefinition(key);
  if (!definition.options.some((o) => o.value === value)) return fail('Esa opción no existe.');
  if (!isSupported(key, value)) return fail('GUTIP todavía no calcula con esa opción.');
  const previous = current.values[key];
  if (previous === value) return fail('Ese ya es el valor vigente.');
  // Repartir por sectores sin etapas completas dejaría una configuración que no calcula.
  if (key === 'groups' && value === STAGED_GROUPS) {
    const check = checkSectors(
      sectorInputs(current.sectors ?? [], current.positions),
      current.positions,
    );
    if (!check.ok) {
      return fail(
        'Para repartir por sectores, primero armá los sectores en "Reparto por sectores" y guardalos.',
      );
    }
  }
  return {
    ok: true,
    draft: {
      ...current,
      values: { ...current.values, [key]: value } as DistributionConfig,
    },
    summary: `${definition.label}: ${optionLabel(key, previous)} → ${optionLabel(key, value)}`,
  };
}

/** Agrega un puesto (con su identidad `id`, que la fuente de datos asigna) a la versión. */
export function planAddPosition(current: PolicyDraft, position: PolicyPosition): PolicyChangePlan {
  const name = position.name.trim();
  if (name === '') return fail('Poné un nombre para el puesto.');
  if (current.positions.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return fail(`Ya existe el puesto "${name}".`);
  }
  const invalid = portionInputError(position.factor);
  if (invalid) return fail(invalid);
  const factor = displayPortion(position.factor);
  return {
    ok: true,
    draft: {
      ...current,
      positions: [...current.positions, { id: position.id, name, factor }],
    },
    summary: `Nuevo puesto: ${name} (porción ${factor})`,
  };
}

export function planPortionChange(
  current: PolicyDraft,
  positionId: string,
  factor: string,
): PolicyChangePlan {
  const position = current.positions.find((p) => p.id === positionId);
  if (!position) return fail('Ese puesto no existe.');
  const invalid = portionInputError(factor);
  if (invalid) return fail(invalid);
  const next = displayPortion(factor);
  if (parseDecimal(next, FACTOR_SCALE) === parseDecimal(position.factor, FACTOR_SCALE)) {
    return fail('Esa ya es la porción vigente.');
  }
  return {
    ok: true,
    draft: {
      ...current,
      positions: current.positions.map((p) => (p.id === positionId ? { ...p, factor: next } : p)),
    },
    summary: `${position.name}: porción ${position.factor} → ${next}`,
  };
}

/** Un sector como lo manda la pantalla, con los puestos que incluye. */
export interface SectorEdit {
  name: string;
  base: SectorBase;
  percent: string;
  positionIds: string[];
}

/** Ids de los sectores del borrador (la fuente de datos les da su id definitivo al guardar). */
export const draftSectorId = (index: number) => `sector-${index + 1}`;

/**
 * Guarda TODOS los sectores de una vez (orden, nombre, base, % y puestos) y activa el reparto por
 * sectores. Solo acepta una configuración completa en la que ningún sector pida más de lo que
 * queda (lo valida `checkSectors`): nunca queda una versión por sectores que no se pueda calcular.
 * Lo que sobre después del último sector se puede guardar (se muestra como sin asignar y el
 * reparto no se cierra hasta resolverlo).
 */
export function planSectorsChange(
  current: PolicyDraft,
  edits: readonly SectorEdit[],
): PolicyChangePlan {
  const known = new Set(current.positions.map((p) => p.id));
  if (edits.some((e) => e.positionIds.some((id) => !known.has(id)))) {
    return fail('Uno de los puestos ya no existe: recargá la página.');
  }
  const sectors: PolicySector[] = edits.map((e, index) => {
    const percentE2 = parseSectorPercent(e.percent);
    return {
      id: draftSectorId(index),
      name: e.name.trim(),
      base: index === 0 ? 'TOTAL' : e.base,
      // Se guarda normalizado ("12,50" → "12,5"); lo inválido queda como se escribió para el error.
      percent: percentE2 !== null ? formatSectorPercent(percentE2) : e.percent,
    };
  });
  const sectorOf = new Map<string, string>();
  edits.forEach((e, index) => {
    for (const id of e.positionIds) if (!sectorOf.has(id)) sectorOf.set(id, draftSectorId(index));
  });
  const inputs = sectors.map((s, index) => ({
    ...s,
    positionIds: edits[index]?.positionIds ?? [],
  }));
  const check = checkSectors(inputs, current.positions);
  if (!check.ok) return fail(check.errors.join(' '));
  // El formato anterior (etapa por puesto) deja de usarse en esta versión.
  const positions = current.positions.map((p) => ({
    ...p,
    stage: null,
    stagePercent: null,
    sectorId: sectorOf.get(p.id) ?? null,
  }));
  if (current.values.groups === STAGED_GROUPS && sameSectors(current, sectors, positions)) {
    return fail('Esa ya es la configuración vigente.');
  }
  const names = new Map(current.positions.map((p) => [p.id, p.name]));
  const summary = `Reparto por sectores: ${sectorsSummary(check.sectors, (id) => names.get(id) ?? '—')}`;
  return {
    ok: true,
    draft: { values: { ...current.values, groups: STAGED_GROUPS }, positions, sectors },
    summary:
      current.values.groups === STAGED_GROUPS
        ? summary
        : `Grupos y porcentajes: Sin grupos → Por sectores. ${summary}`,
  };
}

/** Misma configuración por sectores (orden, nombre, base, % y puestos de cada uno). */
function sameSectors(
  current: PolicyDraft,
  sectors: readonly PolicySector[],
  positions: readonly PolicyPosition[],
): boolean {
  const before = current.sectors ?? [];
  if (before.length !== sectors.length) return false;
  const key = (list: readonly PolicySector[], ps: readonly PolicyPosition[]) =>
    list.map((s) =>
      JSON.stringify([
        s.name,
        s.base,
        String(parseSectorPercent(s.percent)),
        ps
          .filter((p) => p.sectorId === s.id)
          .map((p) => p.id)
          .sort(),
      ]),
    );
  const a = key(before, current.positions);
  const b = key(sectors, positions);
  return a.every((value, index) => value === b[index]);
}
