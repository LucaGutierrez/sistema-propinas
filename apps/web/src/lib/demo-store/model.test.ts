import { describe, expect, it } from 'vitest';
import {
  addPosition,
  addStaff,
  closeWeek,
  monthlySummary,
  openWeek,
  seedVenue,
  setDailyTip,
  setHours,
  setStaffActive,
  startWeek,
  suggestedStartDate,
  weekTotal,
  type Venue,
  type Outcome,
} from './model';
import { addAdvance } from './advances';

const CLOSED_AT = '2026-09-26T12:00:00.000Z';

/** Carga un adelanto (movimiento) el primer día de la semana de prueba. */
const adv = (venue: Venue, weekId: string, staffId: string, amount: string, date = '2026-09-21') =>
  addAdvance(venue, weekId, {
    id: `a-${weekId}-${staffId}-${amount}`,
    staffId,
    date,
    amount,
    note: '',
    by: 'Encargado',
    at: CLOSED_AT,
  });

function ok(outcome: Outcome): Venue {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.venue;
}

function err(outcome: Outcome): string {
  if (outcome.ok) throw new Error('Se esperaba un error');
  return outcome.error;
}

describe('estado inicial', () => {
  const venue = seedVenue(CLOSED_AT);

  it('trae la semana de la planilla cerrada con $347.990 repartidos', () => {
    expect(venue.weeks).toHaveLength(1);
    const week = venue.weeks[0];
    expect(week?.status).toBe('CERRADA');
    expect(week?.result?.totalCents).toBe('34799000');
    expect(week?.result?.totalAdvanceCents).toBe('1000000');
    expect(week?.result?.totalFinalCents).toBe('33799000');
    expect(week?.result?.rows).toHaveLength(12);
    const sum = week?.result?.rows.reduce((s, r) => s + BigInt(r.amountCents), 0n);
    expect(sum).toBe(34_799_000n);
  });

  it('no hay semana abierta', () => {
    expect(openWeek(venue)).toBeUndefined();
  });
});

describe('semana', () => {
  const seeded = seedVenue(CLOSED_AT);

  it('suma los pozos diarios y reparte una vez al cerrar', () => {
    let venue = ok(startWeek(seeded, '2026-09-21', 'w1', CLOSED_AT));
    venue = ok(setDailyTip(venue, 'w1', '2026-09-21', '40.000'));
    venue = ok(setDailyTip(venue, 'w1', '2026-09-22', '60.000'));
    const week = openWeek(venue);
    expect(week && weekTotal(week)).toMatchObject({ totalCents: 10_000_000n, daysWithTips: 2 });

    // Dos personas del mismo puesto (factor 0,022), 30 h y 10 h → 75 % / 25 % de $100.000
    venue = ok(setHours(venue, 'w1', 'roro', '30'));
    venue = ok(setHours(venue, 'w1', 'marcos', '10'));
    venue = ok(adv(venue, 'w1', 'marcos', '5.000'));
    venue = ok(closeWeek(venue, 'w1', CLOSED_AT));

    const closed = venue.weeks.find((w) => w.id === 'w1');
    expect(closed?.status).toBe('CERRADA');
    expect(closed?.result?.rows.map((r) => [r.staffId, r.amountCents, r.finalCents])).toEqual([
      ['roro', '7500000', '7500000'],
      ['marcos', '2500000', '2000000'],
    ]);
  });

  it('una semana cerrada no se modifica', () => {
    const venue = ok(startWeek(seeded, '2026-09-21', 'w1', CLOSED_AT));
    const withTip = ok(setDailyTip(venue, 'w1', '2026-09-21', '1.000'));
    const withHours = ok(setHours(withTip, 'w1', 'roro', '8'));
    const closed = ok(closeWeek(withHours, 'w1', CLOSED_AT));
    expect(err(setDailyTip(closed, 'w1', '2026-09-22', '5'))).toMatch(/cerrada/);
    expect(err(setHours(closed, 'w1', 'roro', '9'))).toMatch(/cerrada/);
    expect(err(closeWeek(closed, 'w1', CLOSED_AT))).toMatch(/cerrada/);
  });

  it('no cierra sin pozo ni sin horas', () => {
    const venue = ok(startWeek(seeded, '2026-09-21', 'w1', CLOSED_AT));
    expect(err(closeWeek(venue, 'w1', CLOSED_AT))).toMatch(/pozo/);
    const withTip = ok(setDailyTip(venue, 'w1', '2026-09-21', '1.000'));
    expect(err(closeWeek(withTip, 'w1', CLOSED_AT))).toMatch(/puntos/);
  });

  it('sugiere el lunes actual, o el día siguiente a la última semana si ya está ocupado', () => {
    expect(suggestedStartDate(seeded, '2026-09-26')).toBe('2026-09-21');
    const closed = ok(startWeek(seeded, '2026-09-21', 'w1', CLOSED_AT));
    expect(suggestedStartDate(closed, '2026-09-26')).toBe('2026-09-28');
  });

  it('solo una semana abierta y sin superponer fechas', () => {
    const venue = ok(startWeek(seeded, '2026-09-21', 'w1', CLOSED_AT));
    expect(err(startWeek(venue, '2026-09-28', 'w2', CLOSED_AT))).toMatch(/abierta/);
    expect(err(startWeek(seeded, '2024-11-20', 'w2', CLOSED_AT))).toMatch(/superponen/);
    expect(err(setDailyTip(venue, 'w1', '2026-09-28', '1'))).toMatch(/no es de esta semana/);
  });

  it('el adelanto que no alcanza pasa como saldo a la semana siguiente', () => {
    let venue = ok(startWeek(seeded, '2026-09-21', 'w1', CLOSED_AT));
    venue = ok(setDailyTip(venue, 'w1', '2026-09-21', '10.000'));
    venue = ok(setHours(venue, 'w1', 'roro', '8'));
    venue = ok(setHours(venue, 'w1', 'marcos', '8'));
    venue = ok(adv(venue, 'w1', 'marcos', '8.000')); // le tocan $5.000
    venue = ok(closeWeek(venue, 'w1', CLOSED_AT));
    const marcos = venue.weeks
      .find((w) => w.id === 'w1')
      ?.result?.rows.find((r) => r.staffId === 'marcos');
    expect(marcos).toMatchObject({
      advanceCents: '500000',
      pendingAdvanceCents: '300000',
      finalCents: '0',
    });

    venue = ok(startWeek(venue, '2026-09-28', 'w2', CLOSED_AT));
    const next = openWeek(venue);
    expect(next?.advanceEntries).toEqual([
      expect.objectContaining({
        staffId: 'marcos',
        amountCents: '300000',
        origin: 'SALDO_ANTERIOR',
        fromWeekId: 'w1',
      }),
    ]);
  });
});

describe('resumen mensual', () => {
  it('suma la propina generada por mes según la fecha de cada día', () => {
    let venue = ok(startWeek(seedVenue(CLOSED_AT), '2026-09-28', 'w1', CLOSED_AT));
    venue = ok(setDailyTip(venue, 'w1', '2026-09-30', '10.000'));
    venue = ok(setDailyTip(venue, 'w1', '2026-10-01', '25.000'));
    const summary = monthlySummary(venue);
    expect(summary.map((m) => [m.month, m.generatedCents])).toEqual([
      ['2026-10', 2_500_000n],
      ['2026-09', 1_000_000n],
      ['2024-11', 34_799_000n],
    ]);
    expect(summary.find((m) => m.month === '2024-11')).toMatchObject({
      closedWeeks: 1,
      envelopesCents: 33_799_000n,
    });
  });
});

describe('personal y puestos', () => {
  const seeded = seedVenue(CLOSED_AT);

  it('agrega un puesto con su factor y una persona en ese puesto', () => {
    let venue = ok(addPosition(seeded, { id: 'cocina', name: 'Cocina', factor: '0,015' }));
    venue = ok(addStaff(venue, { id: 'p1', name: 'Nuevo', positionId: 'cocina' }));
    expect(venue.staff.find((s) => s.id === 'p1')).toMatchObject({
      active: true,
      positionId: 'cocina',
    });
  });

  it('valida nombres y factores', () => {
    expect(err(addPosition(seeded, { id: 'x', name: 'barra', factor: '0,02' }))).toMatch(
      /Ya existe/,
    );
    expect(err(addPosition(seeded, { id: 'x', name: 'Runner', factor: 'abc' }))).toMatch(/factor/);
    expect(err(addStaff(seeded, { id: 'x', name: 'Leo', positionId: 'salon' }))).toMatch(/Ya hay/);
    expect(err(addStaff(seeded, { id: 'x', name: 'Ana', positionId: 'nada' }))).toMatch(/puesto/);
  });

  it('quien está de baja no entra en el reparto pero sigue en las semanas cerradas', () => {
    let venue = ok(setStaffActive(seeded, 'leo', false));
    venue = ok(startWeek(venue, '2026-09-21', 'w1', CLOSED_AT));
    venue = ok(setDailyTip(venue, 'w1', '2026-09-21', '1.000'));
    venue = ok(setHours(venue, 'w1', 'leo', '8'));
    venue = ok(setHours(venue, 'w1', 'roro', '8'));
    venue = ok(closeWeek(venue, 'w1', CLOSED_AT));
    const rows = venue.weeks.find((w) => w.id === 'w1')?.result?.rows ?? [];
    expect(rows.map((r) => r.staffId)).toEqual(['roro']);
    expect(venue.weeks[0]?.result?.rows.some((r) => r.staffId === 'leo')).toBe(true);
  });
});
