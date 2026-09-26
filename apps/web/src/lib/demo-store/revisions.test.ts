import { describe, expect, it } from 'vitest';
import { deliverEnvelope, envelopeOf, prepareEnvelope, revertDelivery } from './envelopes';
import { closeWeek, seedVenue, setHours, startWeek, type Outcome, type Venue } from './model';
import { voidBlocker, voidWeek } from './revisions';

const AT = '2026-09-26T12:00:00.000Z';
const WEEK = 'semana-planilla';
const REASON = 'Faltaron las horas de Marcos';

function ok(outcome: Outcome): Venue {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.venue;
}

function err(outcome: Outcome): string {
  if (outcome.ok) throw new Error('Se esperaba un error');
  return outcome.error;
}

const weekOf = (venue: Venue, id = WEEK) => {
  const week = venue.weeks.find((w) => w.id === id);
  if (!week) throw new Error('semana no encontrada');
  return week;
};

describe('anular y rehacer una semana cerrada', () => {
  const venue = seedVenue(AT);

  it('vuelve a abrirla, guarda el cierre anulado y sube la revisión', () => {
    const prepared = ok(prepareEnvelope(venue, WEEK, 'roro', 'Encargado', AT));
    const voided = ok(voidWeek(prepared, WEEK, 'Encargado', AT, REASON));
    const week = weekOf(voided);
    expect(week).toMatchObject({ status: 'ABIERTA', revision: 2 });
    expect(week.result).toBeUndefined();
    expect(week.envelopes).toBeUndefined();
    const [old] = week.voidedRevisions ?? [];
    expect(old).toMatchObject({ revision: 1, voidedBy: 'Encargado', voidReason: REASON });
    expect(old?.result.totalCents).toBe('34799000');
    // El sobre que estaba preparado registra la anulación en su historial.
    expect(old?.envelopes?.roro?.events.map((e) => e.type)).toEqual(['PREPARADO', 'ANULADO']);
  });

  it('al volver a cerrar hay un reparto nuevo con sobres nuevos', () => {
    let v = ok(voidWeek(venue, WEEK, 'Encargado', AT, REASON));
    v = ok(setHours(v, WEEK, 'marcos', '20'));
    v = ok(closeWeek(v, WEEK, AT));
    const week = weekOf(v);
    expect(week.status).toBe('CERRADA');
    expect(week.result?.rows.find((r) => r.staffId === 'marcos')?.hoursE2).toBe('2000');
    expect(envelopeOf(week, 'roro').status).toBe('PENDIENTE');
    expect(week.voidedRevisions).toHaveLength(1);
  });

  it('exige motivo', () => {
    expect(err(voidWeek(venue, WEEK, 'Encargado', AT, 'corto'))).toMatch(/motivo/);
  });

  it('no se puede con sobres entregados; se puede después de revertir la entrega', () => {
    let v = ok(prepareEnvelope(venue, WEEK, 'roro', 'Encargado', AT));
    v = ok(deliverEnvelope(v, WEEK, 'roro', 'Encargado', AT));
    expect(err(voidWeek(v, WEEK, 'Encargado', AT, REASON))).toMatch(/sobre entregado/);
    v = ok(revertDelivery(v, WEEK, 'roro', 'Encargado', AT, 'Hay que corregir la semana'));
    expect(voidBlocker(v, weekOf(v))).toBeNull();
  });

  it('solo la última semana registrada, y nunca una semana abierta', () => {
    const withNext = ok(startWeek(venue, '2026-09-21', 'w1', AT));
    expect(err(voidWeek(withNext, WEEK, 'Encargado', AT, REASON))).toMatch(/última semana/);
    expect(err(voidWeek(withNext, 'w1', 'Encargado', AT, REASON))).toMatch(/semana cerrada/);
  });
});
