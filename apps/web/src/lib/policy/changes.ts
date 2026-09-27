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

/** Un puesto dentro de una versión: identidad estable (`id`), nombre y porción ("0,022"). */
export interface PolicyPosition {
  id: string;
  name: string;
  factor: string;
}

/** Lo que define una versión de la política (sin número, autor ni fecha). */
export interface PolicyDraft {
  values: DistributionConfig;
  positions: PolicyPosition[];
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
  return {
    ok: true,
    draft: {
      values: { ...current.values, [key]: value } as DistributionConfig,
      positions: current.positions,
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
      values: current.values,
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
      values: current.values,
      positions: current.positions.map((p) => (p.id === positionId ? { ...p, factor: next } : p)),
    },
    summary: `${position.name}: porción ${position.factor} → ${next}`,
  };
}
