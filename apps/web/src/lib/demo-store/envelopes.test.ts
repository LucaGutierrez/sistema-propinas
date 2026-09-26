import { describe, expect, it } from 'vitest';
import {
  deliverEnvelope,
  envelopeOf,
  envelopeRows,
  envelopeSummary,
  prepareAllEnvelopes,
  prepareEnvelope,
  revertDelivery,
  undoPreparation,
} from './envelopes';
import {
  closeWeek,
  seedVenue,
  setDailyTip,
  setHours,
  startWeek,
  type Outcome,
  type Venue,
} from './model';
import { addAdvance } from './advances';
import { permissionsFor } from './permissions';

const AT = '2026-09-26T12:00:00.000Z';

/** Carga un adelanto (movimiento) el primer día de la semana de prueba. */
const adv = (venue: Venue, weekId: string, staffId: string, amount: string, date = '2026-09-21') =>
  addAdvance(venue, weekId, {
    id: `a-${weekId}-${staffId}-${amount}`,
    staffId,
    date,
    amount,
    note: '',
    by: 'Encargado',
    at: AT,
  });
const WEEK = 'semana-planilla';
const REASON = 'Se entregó al empleado equivocado';

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

describe('sobres', () => {
  const venue = seedVenue(AT);

  it('uno por persona con propina; al empezar están pendientes', () => {
    const week = weekOf(venue);
    expect(envelopeRows(week)).toHaveLength(12);
    expect(envelopeOf(week, 'roro')).toEqual({ status: 'PENDIENTE', events: [] });
    expect(envelopeSummary(week)).toMatchObject({ total: 12, pendientes: 12, entregados: 0 });
  });

  it('PENDIENTE → PREPARADO → ENTREGADO, con quién y cuándo, y un evento por paso', () => {
    let v = ok(prepareEnvelope(venue, WEEK, 'roro', 'Encargado', AT));
    v = ok(deliverEnvelope(v, WEEK, 'roro', 'Encargado', AT, 'Entregado en mano'));
    const envelope = envelopeOf(weekOf(v), 'roro');
    expect(envelope).toMatchObject({
      status: 'ENTREGADO',
      preparedBy: 'Encargado',
      deliveredAt: AT,
      deliveredBy: 'Encargado',
      deliveryNote: 'Entregado en mano',
    });
    expect(envelope.events.map((e) => e.type)).toEqual(['PREPARADO', 'ENTREGADO']);
    const row = weekOf(v).result?.rows.find((r) => r.staffId === 'roro');
    expect(envelope.events[1]?.amountCents).toBe(row?.finalCents);
  });

  it('no se entrega sin preparar ni se entrega dos veces', () => {
    expect(err(deliverEnvelope(venue, WEEK, 'roro', 'Encargado', AT))).toMatch(/preparar/);
    let v = ok(prepareEnvelope(venue, WEEK, 'roro', 'Encargado', AT));
    expect(err(prepareEnvelope(v, WEEK, 'roro', 'Encargado', AT))).toMatch(/ya está preparado/);
    v = ok(deliverEnvelope(v, WEEK, 'roro', 'Encargado', AT));
    expect(err(deliverEnvelope(v, WEEK, 'roro', 'Encargado', AT))).toMatch(/ya fue entregado/);
  });

  it('deshacer la preparación exige motivo de 10 caracteres', () => {
    const v = ok(prepareEnvelope(venue, WEEK, 'roro', 'Encargado', AT));
    expect(err(undoPreparation(v, WEEK, 'roro', 'Encargado', AT, 'corto'))).toMatch(/motivo/);
    const undone = ok(
      undoPreparation(v, WEEK, 'roro', 'Encargado', AT, 'Faltaba plata en el sobre'),
    );
    const envelope = envelopeOf(weekOf(undone), 'roro');
    expect(envelope.status).toBe('PENDIENTE');
    expect(envelope.preparedAt).toBeUndefined();
    expect(envelope.events.at(-1)).toMatchObject({ type: 'PREPARACION_DESHECHA' });
  });

  it('revertir una entrega vuelve a PREPARADO, limpia la entrega y conserva la historia', () => {
    let v = ok(prepareEnvelope(venue, WEEK, 'roro', 'Encargado', AT));
    v = ok(deliverEnvelope(v, WEEK, 'roro', 'Encargado', AT, 'nota'));
    expect(err(revertDelivery(v, WEEK, 'roro', 'Encargado', AT, ''))).toMatch(/motivo/);
    v = ok(revertDelivery(v, WEEK, 'roro', 'Encargado', AT, REASON));
    const envelope = envelopeOf(weekOf(v), 'roro');
    expect(envelope).toMatchObject({ status: 'PREPARADO', preparedBy: 'Encargado' });
    expect(envelope.deliveredAt).toBeUndefined();
    expect(envelope.deliveryNote).toBeUndefined();
    expect(envelope.events.map((e) => e.type)).toEqual([
      'PREPARADO',
      'ENTREGADO',
      'ENTREGA_REVERTIDA',
    ]);
    expect(envelope.events.at(-1)?.reason).toBe(REASON);
  });

  it('prepara todos los pendientes de una vez', () => {
    const v = ok(prepareAllEnvelopes(venue, WEEK, 'Encargado', AT));
    expect(envelopeSummary(weekOf(v))).toMatchObject({ preparados: 12, pendientes: 0 });
    expect(err(prepareAllEnvelopes(v, WEEK, 'Encargado', AT))).toMatch(/No hay sobres/);
  });

  it('solo en semanas cerradas, y un sobre sin importe no se prepara', () => {
    let v = ok(startWeek(venue, '2026-09-21', 'w1', AT));
    expect(err(prepareEnvelope(v, 'w1', 'roro', 'Encargado', AT))).toMatch(/cerrar la semana/);
    v = ok(setDailyTip(v, 'w1', '2026-09-21', '10.000'));
    v = ok(setHours(v, 'w1', 'roro', '8'));
    v = ok(setHours(v, 'w1', 'marcos', '8'));
    v = ok(adv(v, 'w1', 'marcos', '9.000'));
    v = ok(closeWeek(v, 'w1', AT));
    const week = weekOf(v, 'w1');
    expect(envelopeSummary(week)).toMatchObject({ total: 2, sinImporte: 1, pendientes: 1 });
    expect(err(prepareEnvelope(v, 'w1', 'marcos', 'Encargado', AT))).toMatch(
      /sin importe|no tiene importe/,
    );
    expect(err(prepareEnvelope(v, 'w1', 'nadie', 'Encargado', AT))).toMatch(/no tiene sobre/);
  });
});

describe('permisos de sobres', () => {
  it('por ahora solo el Encargado prepara, entrega y revierte (P8 pendiente)', () => {
    const table = (['ENCARGADO', 'EDITOR', 'LECTOR', 'PROPIO'] as const).map((role) => {
      const p = permissionsFor(role);
      return [role, p.handleEnvelopes, p.revertDelivery];
    });
    expect(table).toEqual([
      ['ENCARGADO', true, true],
      ['EDITOR', false, false],
      ['LECTOR', false, false],
      ['PROPIO', false, false],
    ]);
  });
});
