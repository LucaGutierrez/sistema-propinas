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
import {
  planAddPosition,
  planConfigValue,
  planPortionChange,
  type PolicyChangePlan,
} from '@/lib/policy/changes';
import { isDatabaseOnly, type ParamKey } from './config';
import { MIN_REASON_LENGTH } from './envelopes';
import { openWeek, type Outcome, type Position, type Venue, type Week } from './model';
import { appendVersion, currentVersion, versionOf, type PolicyVersion } from './policy';

const fail = (error: string): Outcome => ({ ok: false, error });

/** ¿La semana fue reabierta para corregirla? Entonces conserva su versión original. */
function isRedo(week: Week): boolean {
  return (week.voidedRevisions?.length ?? 0) > 0;
}

/** Aplica a la demo un cambio validado por `@/lib/policy/changes` (mismas reglas que la base). */
function changePolicy(
  venue: Venue,
  plan: (current: PolicyVersion) => PolicyChangePlan,
  by: string,
  at: string,
): Outcome {
  const current = currentVersion(venue.policy);
  const result = plan(current);
  if (!result.ok) return fail(result.error);

  const { policy, version } = appendVersion(venue.policy, {
    createdAt: at,
    createdBy: by,
    origin: 'CAMBIO',
    summary: result.summary,
    values: result.draft.values,
    positions: result.draft.positions,
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
  if (isDatabaseOnly(key, value)) {
    return fail(
      'En la demo todavía no se puede calcular con esa opción (necesita la base de datos).',
    );
  }
  return changePolicy(venue, (current) => planConfigValue(current, key, value), by, at);
}

export function addPosition(venue: Venue, position: Position, by: string, at: string): Outcome {
  return changePolicy(venue, (current) => planAddPosition(current, position), by, at);
}

export function setPositionFactor(
  venue: Venue,
  positionId: string,
  factor: string,
  by: string,
  at: string,
): Outcome {
  return changePolicy(venue, (current) => planPortionChange(current, positionId, factor), by, at);
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
