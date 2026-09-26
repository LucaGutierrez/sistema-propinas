/**
 * Sobres de una semana cerrada: preparar, entregar y corregir. Sigue las reglas aprobadas en
 * DATABASE.md (weekly_payments / weekly_payment_events):
 *
 *   PENDIENTE → PREPARADO → ENTREGADO
 *   PREPARADO → PENDIENTE     (deshacer preparación: motivo obligatorio)
 *   ENTREGADO → PREPARADO     (revertir entrega: motivo obligatorio; solo el encargado)
 *
 * Cada cambio agrega un evento (bitácora que no se edita). Los importes no cambian nunca: salen
 * del cierre de la semana. Hay un sobre por persona con propina > 0; si los adelantos se
 * llevaron todo, el sobre existe pero no hay importe para entregar.
 */
import type { ClosedRow, Outcome, Venue, Week } from './model';

export type EnvelopeStatus = 'PENDIENTE' | 'PREPARADO' | 'ENTREGADO';

export type EnvelopeEventType =
  'PREPARADO' | 'PREPARACION_DESHECHA' | 'ENTREGADO' | 'ENTREGA_REVERTIDA';

export interface EnvelopeEvent {
  type: EnvelopeEventType;
  /** ISO, lo fija quien registra (en la versión real, el servidor). */
  at: string;
  by: string;
  amountCents: string;
  reason?: string;
  note?: string;
}

export interface Envelope {
  status: EnvelopeStatus;
  preparedAt?: string;
  preparedBy?: string;
  deliveredAt?: string;
  deliveredBy?: string;
  deliveryNote?: string;
  events: EnvelopeEvent[];
}

export const MIN_REASON_LENGTH = 10;

const fail = (error: string): Outcome => ({ ok: false, error });

/** Personas con sobre en una semana cerrada (propina > 0). */
export function envelopeRows(week: Week): ClosedRow[] {
  return (week.result?.rows ?? []).filter((row) => BigInt(row.amountCents) > 0n);
}

/** Estado del sobre; las semanas cerradas antes de existir los sobres empiezan en PENDIENTE. */
export function envelopeOf(week: Week, staffId: string): Envelope {
  return week.envelopes?.[staffId] ?? { status: 'PENDIENTE', events: [] };
}

export function hasAmountToDeliver(row: ClosedRow): boolean {
  return BigInt(row.finalCents) > 0n;
}

export interface EnvelopeSummary {
  total: number;
  pendientes: number;
  preparados: number;
  entregados: number;
  /** Sobres sin importe (los adelantos se llevaron todo). */
  sinImporte: number;
  pendingCents: bigint;
  deliveredCents: bigint;
}

export function envelopeSummary(week: Week): EnvelopeSummary {
  const summary: EnvelopeSummary = {
    total: 0,
    pendientes: 0,
    preparados: 0,
    entregados: 0,
    sinImporte: 0,
    pendingCents: 0n,
    deliveredCents: 0n,
  };
  for (const row of envelopeRows(week)) {
    summary.total += 1;
    if (!hasAmountToDeliver(row)) {
      summary.sinImporte += 1;
      continue;
    }
    const cents = BigInt(row.finalCents);
    const { status } = envelopeOf(week, row.staffId);
    if (status === 'ENTREGADO') {
      summary.entregados += 1;
      summary.deliveredCents += cents;
    } else {
      if (status === 'PREPARADO') summary.preparados += 1;
      else summary.pendientes += 1;
      summary.pendingCents += cents;
    }
  }
  return summary;
}

type Transition = (envelope: Envelope, row: ClosedRow) => Envelope | string;

function transition(venue: Venue, weekId: string, staffId: string, apply: Transition): Outcome {
  const week = venue.weeks.find((w) => w.id === weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'CERRADA' || !week.result) {
    return fail('Los sobres se manejan después de cerrar la semana.');
  }
  const row = envelopeRows(week).find((r) => r.staffId === staffId);
  if (!row) return fail('Esa persona no tiene sobre en esta semana.');
  if (!hasAmountToDeliver(row)) return fail('Este sobre no tiene importe para entregar.');

  const next = apply(envelopeOf(week, staffId), row);
  if (typeof next === 'string') return fail(next);
  const updated: Week = { ...week, envelopes: { ...week.envelopes, [staffId]: next } };
  return {
    ok: true,
    venue: { ...venue, weeks: venue.weeks.map((w) => (w.id === weekId ? updated : w)) },
  };
}

function validReason(reason: string): string | null {
  return reason.trim().length >= MIN_REASON_LENGTH
    ? null
    : `El motivo es obligatorio (mínimo ${MIN_REASON_LENGTH} caracteres).`;
}

export function prepareEnvelope(
  venue: Venue,
  weekId: string,
  staffId: string,
  by: string,
  at: string,
): Outcome {
  return transition(venue, weekId, staffId, (envelope, row) => {
    if (envelope.status !== 'PENDIENTE') return 'El sobre ya está preparado.';
    return {
      ...envelope,
      status: 'PREPARADO',
      preparedAt: at,
      preparedBy: by,
      events: [...envelope.events, { type: 'PREPARADO', at, by, amountCents: row.finalCents }],
    };
  });
}

export function undoPreparation(
  venue: Venue,
  weekId: string,
  staffId: string,
  by: string,
  at: string,
  reason: string,
): Outcome {
  return transition(venue, weekId, staffId, (envelope, row) => {
    if (envelope.status !== 'PREPARADO') return 'Solo se puede deshacer un sobre preparado.';
    const invalid = validReason(reason);
    if (invalid) return invalid;
    return {
      status: 'PENDIENTE',
      events: [
        ...envelope.events,
        {
          type: 'PREPARACION_DESHECHA',
          at,
          by,
          amountCents: row.finalCents,
          reason: reason.trim(),
        },
      ],
    };
  });
}

export function deliverEnvelope(
  venue: Venue,
  weekId: string,
  staffId: string,
  by: string,
  at: string,
  note = '',
): Outcome {
  return transition(venue, weekId, staffId, (envelope, row) => {
    if (envelope.status === 'ENTREGADO') return 'El sobre ya fue entregado.';
    if (envelope.status !== 'PREPARADO') return 'Primero hay que preparar el sobre.';
    const trimmed = note.trim();
    return {
      ...envelope,
      status: 'ENTREGADO',
      deliveredAt: at,
      deliveredBy: by,
      ...(trimmed ? { deliveryNote: trimmed } : {}),
      events: [
        ...envelope.events,
        {
          type: 'ENTREGADO',
          at,
          by,
          amountCents: row.finalCents,
          ...(trimmed ? { note: trimmed } : {}),
        },
      ],
    };
  });
}

/** Corrige una entrega: vuelve a PREPARADO. Limpia la entrega (y su nota), no la preparación. */
export function revertDelivery(
  venue: Venue,
  weekId: string,
  staffId: string,
  by: string,
  at: string,
  reason: string,
): Outcome {
  return transition(venue, weekId, staffId, (envelope, row) => {
    if (envelope.status !== 'ENTREGADO') return 'Solo se puede revertir un sobre entregado.';
    const invalid = validReason(reason);
    if (invalid) return invalid;
    return {
      status: 'PREPARADO',
      preparedAt: envelope.preparedAt,
      preparedBy: envelope.preparedBy,
      events: [
        ...envelope.events,
        { type: 'ENTREGA_REVERTIDA', at, by, amountCents: row.finalCents, reason: reason.trim() },
      ],
    };
  });
}

/** Prepara de una vez todos los sobres pendientes con importe. */
export function prepareAllEnvelopes(venue: Venue, weekId: string, by: string, at: string): Outcome {
  const week = venue.weeks.find((w) => w.id === weekId);
  if (!week || week.status !== 'CERRADA')
    return fail('Los sobres se manejan después de cerrar la semana.');
  let current: Venue = venue;
  let changed = 0;
  for (const row of envelopeRows(week)) {
    if (!hasAmountToDeliver(row) || envelopeOf(week, row.staffId).status !== 'PENDIENTE') continue;
    const outcome = prepareEnvelope(current, weekId, row.staffId, by, at);
    if (!outcome.ok) return outcome;
    current = outcome.venue;
    changed += 1;
  }
  if (changed === 0) return fail('No hay sobres pendientes de preparar.');
  return { ok: true, venue: current };
}
