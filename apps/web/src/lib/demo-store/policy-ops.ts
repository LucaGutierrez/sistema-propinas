/**
 * Cambios a la política de un local (CONFIG-MODEL.md). Cada cambio crea una versión nueva,
 * que queda vigente para los próximos períodos. Además:
 *
 * - Si hay una semana abierta, pasa a la versión nueva y su vista previa se recalcula; queda
 *   registrado (automático). EXCEPCIÓN: una semana reabierta tras anular su cierre conserva la
 *   versión con la que se calculó originalmente; pasarla a otra es una elección explícita del
 *   Encargado, con motivo (`repinWeek`).
 * - Las semanas cerradas nunca cambian: guardan su versión y una copia de los valores.
 *
 * Cambiar datos del período (horas, pozos, adelantos) o del personal NO crea versiones.
 */
import { formatScaled, parseDecimal } from '@/lib/decimal';
import { FACTOR_SCALE } from '@/lib/distribution/provisional-formula';
import {
  isSupported,
  optionLabel,
  paramDefinition,
  type DistributionConfig,
  type ParamKey,
} from './config';
import { MIN_REASON_LENGTH } from './envelopes';
import { openWeek, type Outcome, type Position, type Venue, type Week } from './model';
import { appendVersion, currentVersion, versionOf, type PolicyVersion } from './policy';

const fail = (error: string): Outcome => ({ ok: false, error });

type Draft = Pick<PolicyVersion, 'values' | 'positions'>;

/** ¿La semana fue reabierta para corregirla? Entonces conserva su versión original. */
function isRedo(week: Week): boolean {
  return (week.voidedRevisions?.length ?? 0) > 0;
}

function changePolicy(
  venue: Venue,
  change: (current: PolicyVersion) => Draft | string,
  summary: string,
  by: string,
  at: string,
): Outcome {
  const current = currentVersion(venue.policy);
  const draft = change(current);
  if (typeof draft === 'string') return fail(draft);

  const { policy, version } = appendVersion(venue.policy, {
    createdAt: at,
    createdBy: by,
    origin: 'CAMBIO',
    summary,
    values: draft.values,
    positions: draft.positions,
  });

  // La semana abierta pasa a la versión nueva (salvo si es una semana rehecha).
  const open = openWeek(venue);
  const weeks = venue.weeks.map((week) => {
    if (!open || week.id !== open.id || isRedo(week)) return week;
    const from = week.policyVersion ?? current.number;
    return {
      ...week,
      policyVersion: version.number,
      policyLog: [...(week.policyLog ?? []), { at, by, from, to: version.number, automatic: true }],
    };
  });

  return { ok: true, venue: { ...venue, policy, weeks } };
}

export function setConfigValue(
  venue: Venue,
  key: ParamKey,
  value: string,
  by: string,
  at: string,
): Outcome {
  const definition = paramDefinition(key);
  if (!definition.options.some((o) => o.value === value)) return fail('Esa opción no existe.');
  if (!isSupported(key, value)) {
    return fail('GUTIP todavía no calcula con esa opción.');
  }
  const previous = currentVersion(venue.policy).values[key];
  if (previous === value) return fail('Ese ya es el valor vigente.');
  return changePolicy(
    venue,
    (current) => ({
      values: { ...current.values, [key]: value } as DistributionConfig,
      positions: current.positions,
    }),
    `${definition.label}: ${optionLabel(key, previous)} → ${optionLabel(key, value)}`,
    by,
    at,
  );
}

function validFactor(factor: string): string | null {
  const factorE4 = parseDecimal(factor, FACTOR_SCALE);
  return factorE4 === null || factorE4 === 0n
    ? 'La porción tiene que ser un número mayor que cero (hasta 4 decimales).'
    : null;
}

/** Normaliza el peso para mostrarlo igual en todos lados ("0.022" → "0,022"). */
function displayFactor(factor: string): string {
  const factorE4 = parseDecimal(factor, FACTOR_SCALE) ?? 0n;
  return formatScaled(factorE4, FACTOR_SCALE, FACTOR_SCALE).replace(/0+$/, '').replace(/,$/, '');
}

export function addPosition(venue: Venue, position: Position, by: string, at: string): Outcome {
  const name = position.name.trim();
  if (name === '') return fail('Poné un nombre para el puesto.');
  const current = currentVersion(venue.policy);
  if (current.positions.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return fail(`Ya existe el puesto "${name}".`);
  }
  const invalid = validFactor(position.factor);
  if (invalid) return fail(invalid);
  const factor = displayFactor(position.factor);
  return changePolicy(
    venue,
    (cur) => ({
      values: cur.values,
      positions: [...cur.positions, { id: position.id, name, factor }],
    }),
    `Nuevo puesto: ${name} (porción ${factor})`,
    by,
    at,
  );
}

export function setPositionFactor(
  venue: Venue,
  positionId: string,
  factor: string,
  by: string,
  at: string,
): Outcome {
  const current = currentVersion(venue.policy);
  const position = current.positions.find((p) => p.id === positionId);
  if (!position) return fail('Ese puesto no existe.');
  const invalid = validFactor(factor);
  if (invalid) return fail(invalid);
  const next = displayFactor(factor);
  if (parseDecimal(next, FACTOR_SCALE) === parseDecimal(position.factor, FACTOR_SCALE)) {
    return fail('Esa ya es la porción vigente.');
  }
  return changePolicy(
    venue,
    (cur) => ({
      values: cur.values,
      positions: cur.positions.map((p) => (p.id === positionId ? { ...p, factor: next } : p)),
    }),
    `${position.name}: porción ${position.factor} → ${next}`,
    by,
    at,
  );
}

/**
 * Cambia a mano la versión de la política de una semana abierta (p. ej. una semana rehecha que
 * se quiere recalcular con la versión vigente). Motivo obligatorio; queda registrado.
 */
export function repinWeek(
  venue: Venue,
  weekId: string,
  versionNumber: number,
  by: string,
  at: string,
  reason: string,
): Outcome {
  const week = venue.weeks.find((w) => w.id === weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'ABIERTA')
    return fail('Solo se puede cambiar la versión de una semana abierta.');
  if (!versionOf(venue.policy, versionNumber)) return fail('Esa versión de la política no existe.');
  const from = week.policyVersion ?? venue.policy.current;
  if (from === versionNumber) return fail('La semana ya usa esa versión.');
  if (reason.trim().length < MIN_REASON_LENGTH) {
    return fail(`El motivo es obligatorio (mínimo ${MIN_REASON_LENGTH} caracteres).`);
  }
  const updated: Week = {
    ...week,
    policyVersion: versionNumber,
    policyLog: [
      ...(week.policyLog ?? []),
      { at, by, from, to: versionNumber, automatic: false, reason: reason.trim() },
    ],
  };
  return {
    ok: true,
    venue: { ...venue, weeks: venue.weeks.map((w) => (w.id === weekId ? updated : w)) },
  };
}
