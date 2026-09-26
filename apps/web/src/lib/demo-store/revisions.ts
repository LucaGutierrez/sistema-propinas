/**
 * Anular el cierre de una semana para corregirla (regla aprobada en DATABASE.md §6):
 * solo si ningún sobre fue entregado y con motivo. El cierre anulado se conserva completo
 * (con sus sobres) como revisión anulada; la semana vuelve a quedar abierta y al volver a
 * cerrarla se generan sobres nuevos.
 *
 * Para no dejar inconsistente el saldo de adelantos que ya pasó a otra semana, solo se puede
 * anular la última semana registrada del local (se anula en orden inverso, como los adelantos).
 */
import { envelopeOf, envelopeRows, MIN_REASON_LENGTH, type Envelope } from './envelopes';
import { findWeek, openWeek, sortedWeeks, type Outcome, type Venue, type Week } from './model';

const fail = (error: string): Outcome => ({ ok: false, error });

/** Por qué no se puede anular la semana, o null si se puede. */
export function voidBlocker(venue: Venue, week: Week): string | null {
  if (week.status !== 'CERRADA' || !week.result) return 'Solo se puede anular una semana cerrada.';
  const delivered = envelopeRows(week).filter(
    (row) => envelopeOf(week, row.staffId).status === 'ENTREGADO',
  );
  if (delivered.length > 0) {
    return `Hay ${delivered.length} ${delivered.length === 1 ? 'sobre entregado' : 'sobres entregados'}: primero hay que revertir ${delivered.length === 1 ? 'la entrega' : 'las entregas'}.`;
  }
  const latest = sortedWeeks(venue)[0];
  if (latest && latest.id !== week.id) {
    return 'Solo se puede anular la última semana registrada del local.';
  }
  const open = openWeek(venue);
  if (open && open.id !== week.id) return 'Hay otra semana abierta: cerrala o anulala primero.';
  return null;
}

export function voidWeek(
  venue: Venue,
  weekId: string,
  by: string,
  at: string,
  reason: string,
): Outcome {
  const week = findWeek(venue, weekId);
  if (!week) return fail('La semana no existe.');
  const blocker = voidBlocker(venue, week);
  if (blocker) return fail(blocker);
  if (reason.trim().length < MIN_REASON_LENGTH) {
    return fail(`El motivo es obligatorio (mínimo ${MIN_REASON_LENGTH} caracteres).`);
  }
  const result = week.result;
  if (!result) return fail('Solo se puede anular una semana cerrada.');

  // Cada sobre del cierre anulado registra la anulación en su historial.
  const envelopes: Record<string, Envelope> = {};
  for (const row of envelopeRows(week)) {
    const envelope = envelopeOf(week, row.staffId);
    envelopes[row.staffId] = {
      ...envelope,
      events: [
        ...envelope.events,
        { type: 'ANULADO', at, by, amountCents: row.finalCents, reason: reason.trim() },
      ],
    };
  }

  const revision = week.revision ?? 1;
  const reopened: Week = {
    ...week,
    status: 'ABIERTA',
    result: undefined,
    envelopes: undefined,
    revision: revision + 1,
    voidedRevisions: [
      ...(week.voidedRevisions ?? []),
      { revision, result, envelopes, voidedAt: at, voidedBy: by, voidReason: reason.trim() },
    ],
  };
  return {
    ok: true,
    venue: { ...venue, weeks: venue.weeks.map((w) => (w.id === weekId ? reopened : w)) },
  };
}
