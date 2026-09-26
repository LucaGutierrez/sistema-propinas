/**
 * Registro de adelantos de una semana abierta: cada adelanto es un movimiento con fecha, monto,
 * nota y quién lo cargó. Nunca se borra: se anula con motivo (misma regla que la base de datos).
 *
 * PROVISIONAL (P6): al cerrar, todos los adelantos vigentes de la semana se descuentan del sobre
 * de esa semana, sin mirar la fecha. Lo que no alcanza pasa como saldo a la semana siguiente.
 * La fecha queda registrada para cuando se decida si importa.
 */
import { weekDays } from '@/lib/dates';
import { parseMoney } from '@/lib/decimal';
import { MIN_REASON_LENGTH } from './envelopes';
import { findWeek, type AdvanceEntry, type Outcome, type Venue, type Week } from './model';

const fail = (error: string): Outcome => ({ ok: false, error });

function replaceWeek(venue: Venue, week: Week): Outcome {
  return {
    ok: true,
    venue: { ...venue, weeks: venue.weeks.map((w) => (w.id === week.id ? week : w)) },
  };
}

export function addAdvance(
  venue: Venue,
  weekId: string,
  params: {
    id: string;
    staffId: string;
    date: string;
    amount: string;
    note: string;
    by: string;
    at: string;
  },
): Outcome {
  const week = findWeek(venue, weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'ABIERTA')
    return fail('La semana está cerrada: no se pueden cargar adelantos.');
  const member = venue.staff.find((s) => s.id === params.staffId);
  if (!member) return fail('Elegí a quién se le dio el adelanto.');
  if (!member.active) return fail(`${member.name} está de baja.`);
  if (!weekDays(week.startDate).includes(params.date)) {
    return fail('La fecha del adelanto tiene que ser de esta semana.');
  }
  const cents = parseMoney(params.amount);
  if (cents === null || cents <= 0n) return fail('Ingresá un monto válido, mayor que cero.');

  const entry: AdvanceEntry = {
    id: params.id,
    staffId: params.staffId,
    date: params.date,
    amountCents: cents.toString(),
    note: params.note.trim(),
    origin: 'MANUAL',
    createdBy: params.by,
    createdAt: params.at,
  };
  return replaceWeek(venue, { ...week, advanceEntries: [...week.advanceEntries, entry] });
}

/** Anula un adelanto de una semana abierta. Queda en el registro, tachado, con el motivo. */
export function voidAdvance(
  venue: Venue,
  weekId: string,
  entryId: string,
  by: string,
  at: string,
  reason: string,
): Outcome {
  const week = findWeek(venue, weekId);
  if (!week) return fail('La semana no existe.');
  if (week.status !== 'ABIERTA')
    return fail('La semana está cerrada: no se pueden anular adelantos.');
  const entry = week.advanceEntries.find((e) => e.id === entryId);
  if (!entry) return fail('Ese adelanto no existe.');
  if (entry.voidedAt) return fail('Ese adelanto ya está anulado.');
  if (reason.trim().length < MIN_REASON_LENGTH) {
    return fail(`El motivo es obligatorio (mínimo ${MIN_REASON_LENGTH} caracteres).`);
  }
  const voided: AdvanceEntry = { ...entry, voidedAt: at, voidedBy: by, voidReason: reason.trim() };
  return replaceWeek(venue, {
    ...week,
    advanceEntries: week.advanceEntries.map((e) => (e.id === entryId ? voided : e)),
  });
}
