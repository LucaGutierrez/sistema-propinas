import { describe, expect, it } from 'vitest';
import { addAdvance, voidAdvance } from './advances';
import {
  advanceTotal,
  closeWeek,
  normalizeVenue,
  seedVenue,
  setDailyTip,
  setHours,
  startWeek,
  type Outcome,
  type Venue,
} from './model';

const AT = '2026-09-26T12:00:00.000Z';

function ok(outcome: Outcome): Venue {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.venue;
}

function err(outcome: Outcome): string {
  if (outcome.ok) throw new Error('Se esperaba un error');
  return outcome.error;
}

const add = (venue: Venue, id: string, staffId: string, amount: string, date = '2026-09-22') =>
  addAdvance(venue, 'w1', { id, staffId, date, amount, note: 'efectivo', by: 'Encargado', at: AT });

const week = (venue: Venue, id = 'w1') => {
  const found = venue.weeks.find((w) => w.id === id);
  if (!found) throw new Error('semana no encontrada');
  return found;
};

describe('registro de adelantos', () => {
  const open = ok(startWeek(seedVenue(AT), '2026-09-21', 'w1', AT));

  it('cada adelanto es un movimiento con fecha, monto, nota y quién lo cargó', () => {
    const venue = ok(add(open, 'a1', 'leo', '5.000'));
    expect(week(venue).advanceEntries).toEqual([
      {
        id: 'a1',
        staffId: 'leo',
        date: '2026-09-22',
        amountCents: '500000',
        note: 'efectivo',
        origin: 'MANUAL',
        createdBy: 'Encargado',
        createdAt: AT,
      },
    ]);
  });

  it('suma los adelantos vigentes de cada persona', () => {
    let venue = ok(add(open, 'a1', 'leo', '5.000'));
    venue = ok(add(venue, 'a2', 'leo', '2.500,50', '2026-09-25'));
    venue = ok(add(venue, 'a3', 'roro', '1.000'));
    expect(advanceTotal(week(venue), 'leo')).toBe(750_050n);
    expect(advanceTotal(week(venue), 'roro')).toBe(100_000n);
  });

  it('valida persona, fecha dentro de la semana y monto', () => {
    expect(err(add(open, 'x', 'nadie', '100'))).toMatch(/a quién/);
    expect(err(add(open, 'x', 'leo', '100', '2026-09-28'))).toMatch(/de esta semana/);
    expect(err(add(open, 'x', 'leo', '0'))).toMatch(/monto/);
    expect(err(add(open, 'x', 'leo', 'mucho'))).toMatch(/monto/);
  });

  it('anular deja el movimiento con motivo y ya no se descuenta', () => {
    let venue = ok(add(open, 'a1', 'leo', '5.000'));
    expect(err(voidAdvance(venue, 'w1', 'a1', 'Encargado', AT, 'corto'))).toMatch(/motivo/);
    venue = ok(voidAdvance(venue, 'w1', 'a1', 'Encargado', AT, 'Se cargó dos veces por error'));
    const [entry] = week(venue).advanceEntries;
    expect(entry).toMatchObject({
      voidedBy: 'Encargado',
      voidReason: 'Se cargó dos veces por error',
    });
    expect(advanceTotal(week(venue), 'leo')).toBe(0n);
    expect(
      err(voidAdvance(venue, 'w1', 'a1', 'Encargado', AT, 'Otra vez el mismo motivo')),
    ).toMatch(/ya está anulado/);
  });

  it('al cerrar se descuentan del sobre y después no se pueden tocar', () => {
    let venue = ok(setDailyTip(open, 'w1', '2026-09-21', '10.000'));
    venue = ok(setHours(venue, 'w1', 'roro', '8'));
    venue = ok(add(venue, 'a1', 'roro', '3.000'));
    venue = ok(closeWeek(venue, 'w1', AT));
    const row = week(venue).result?.rows.find((r) => r.staffId === 'roro');
    expect(row).toMatchObject({
      amountCents: '1000000',
      advanceCents: '300000',
      finalCents: '700000',
    });
    expect(err(add(venue, 'a2', 'roro', '1'))).toMatch(/cerrada/);
    expect(
      err(voidAdvance(venue, 'w1', 'a1', 'Encargado', AT, 'Motivo suficientemente largo')),
    ).toMatch(/cerrada/);
  });
});

describe('datos guardados con el formato anterior', () => {
  it('convierte monto por persona y saldo arrastrado en movimientos', () => {
    const legacy = {
      ...seedVenue(AT),
      weeks: [
        {
          id: 'w9',
          startDate: '2026-09-21',
          status: 'ABIERTA',
          tips: {},
          hours: {},
          advances: { nahuel: '29.541,67', leo: '5.000' },
          carried: { nahuel: '2954167' },
        },
      ],
    };
    const venue = normalizeVenue(legacy);
    const entries = venue?.weeks[0]?.advanceEntries ?? [];
    expect(entries.map((e) => [e.staffId, e.origin, e.amountCents])).toEqual([
      ['nahuel', 'SALDO_ANTERIOR', '2954167'],
      ['leo', 'MANUAL', '500000'],
    ]);
    expect(advanceTotal(venue!.weeks[0]!, 'nahuel')).toBe(2_954_167n);
  });
});
