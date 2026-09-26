import { describe, expect, it } from 'vitest';
import { calculateFromForm } from './form';
import {
  FORMULA_STATUS,
  ProvisionalFormulaError,
  computeProvisionalDistribution,
  type ProvisionalRow,
} from './provisional-formula';
import { SEED_POSITIONS, SEED_STAFF, SEED_WEEK } from '@/lib/demo/data';

const factorOf = (positionId: string) =>
  SEED_POSITIONS.find((p) => p.id === positionId)?.factor ?? '';

const row = (id: string, hours: bigint, factor: bigint, advance = 0n): ProvisionalRow => ({
  id,
  hoursE2: hours * 100n,
  factorE4: factor,
  advanceCents: advance,
});

describe('fórmula provisional', () => {
  it('está marcada como PROVISIONAL', () => {
    expect(FORMULA_STATUS).toBe('PROVISIONAL');
    const result = computeProvisionalDistribution(100n, [row('a', 1n, 10_000n)]);
    expect(result.status).toBe('PROVISIONAL');
  });

  it('reparte proporcional a horas × factor', () => {
    // a: 30 h × 0,02 = 0,6 · b: 10 h × 0,04 = 0,4 → 60 % / 40 % de $1.000
    const result = computeProvisionalDistribution(100_000n, [
      row('a', 30n, 200n),
      row('b', 10n, 400n),
    ]);
    expect(result.items.map((i) => i.pointsE6)).toEqual([600_000n, 400_000n]);
    expect(result.items.map((i) => i.percentE2)).toEqual([6000n, 4000n]);
    expect(result.items.map((i) => i.amountCents)).toEqual([60_000n, 40_000n]);
  });

  it('acepta horas semanales de más de 24', () => {
    const result = computeProvisionalDistribution(100_000n, [
      row('a', 54n, 220n),
      row('b', 45n, 220n),
    ]);
    expect(result.items[0]?.hoursE2).toBe(5400n);
  });

  it('reparte por mayor resto: la suma coincide con el pozo al centavo', () => {
    const result = computeProvisionalDistribution(100n, [
      row('a', 1n, 100n),
      row('b', 1n, 100n),
      row('c', 1n, 100n),
    ]);
    expect(result.items.map((i) => i.amountCents)).toEqual([34n, 33n, 33n]);
  });

  it('descuenta el adelanto y deja saldo si no alcanza', () => {
    const result = computeProvisionalDistribution(100_000n, [
      row('a', 1n, 100n, 30_000n),
      row('b', 1n, 100n, 80_000n),
    ]);
    const [a, b] = result.items;
    expect(a).toMatchObject({
      amountCents: 50_000n,
      advanceAppliedCents: 30_000n,
      finalCents: 20_000n,
    });
    expect(b).toMatchObject({
      amountCents: 50_000n,
      advanceAppliedCents: 50_000n,
      pendingAdvanceCents: 30_000n,
      finalCents: 0n,
    });
    expect(result.totalFinalCents).toBe(20_000n);
  });

  it('una fila sin horas recibe cero', () => {
    const result = computeProvisionalDistribution(100_000n, [
      row('a', 0n, 100n),
      row('b', 8n, 100n),
    ]);
    expect(result.items[0]).toMatchObject({ pointsE6: 0n, amountCents: 0n, finalCents: 0n });
    expect(result.items[1]?.amountCents).toBe(100_000n);
  });

  it('rechaza pozo cero y distribuciones sin puntos', () => {
    expect(() => computeProvisionalDistribution(0n, [row('a', 1n, 1n)])).toThrow(
      ProvisionalFormulaError,
    );
    expect(() => computeProvisionalDistribution(100n, [row('a', 0n, 1n)])).toThrow(
      ProvisionalFormulaError,
    );
  });
});

describe('datos demo', () => {
  const demo = calculateFromForm({
    total: SEED_WEEK.total,
    rows: SEED_STAFF.map((s) => ({
      id: s.id,
      name: s.name,
      hours: s.weekHours,
      factor: factorOf(s.positionId),
      advance: s.advance,
    })),
  });

  it('calcula sin errores y reparte exactamente $347.990', () => {
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;
    const { result } = demo;
    expect(result.totalCents).toBe(34_799_000n);
    expect(result.items.reduce((sum, i) => sum + i.amountCents, 0n)).toBe(34_799_000n);
    // Σ horas × factor = 5,398 (con los factores redondeados de la planilla).
    expect(result.totalPointsE6).toBe(5_398_000n);
    expect(result.totalAdvanceCents).toBe(1_000_000n);
    expect(result.totalFinalCents).toBe(33_799_000n);
  });

  it('Leo: 54 h × 0,022 = 1,188 puntos; se descuenta el adelanto de $10.000', () => {
    if (!demo.ok) throw new Error('demo inválida');
    const leo = demo.result.items.find((i) => i.id === 'leo');
    // 34.799.000 centavos × 1,188 / 5,398 = 7.658.616,52... → 7.658.616 (o +1 por mayor resto)
    expect(leo?.pointsE6).toBe(1_188_000n);
    expect(leo?.amountCents === 7_658_616n || leo?.amountCents === 7_658_617n).toBe(true);
    expect(leo?.advanceAppliedCents).toBe(1_000_000n);
    expect((leo?.amountCents ?? 0n) - (leo?.finalCents ?? 0n)).toBe(1_000_000n);
  });

  it('con la porción de la base (10 decimales) los importes de Library no cambian', () => {
    // La base guarda la porción como NUMERIC(20,10). El reparto es proporcional, así que la
    // escala de la porción no altera los importes: 0,022 en E4 (220) o en E10 (220000000).
    if (!demo.ok) throw new Error('demo inválida');
    const E10_PER_E4 = 1_000_000n;
    // El adelanto no interviene en el importe (solo en el final), así que acá no hace falta.
    const rowsE10: ProvisionalRow[] = demo.result.items.map((item) => ({
      id: item.id,
      hoursE2: item.hoursE2,
      factorE4: item.factorE4 * E10_PER_E4,
      advanceCents: 0n,
    }));
    const e10 = computeProvisionalDistribution(demo.result.totalCents, rowsE10);
    // Los 12 importes de la semana de Library (fórmula provisional), fijados como regresión.
    const library = [
      ['ivan', 4_061_388n],
      ['nardelli', 1_624_555n],
      ['roro', 6_382_180n],
      ['marcos', 1_843_741n],
      ['leo', 7_658_617n],
      ['isaias', 5_105_744n],
      ['agus-fulleda', 4_538_439n],
      ['cami-noche', 709_131n],
      ['agus-noche', 709_131n],
      ['nahuel', 1_083_037n],
      ['jesus', 902_531n],
      ['jean', 180_506n],
    ];
    expect(demo.result.items.map((i) => [i.id, i.amountCents])).toEqual(library);
    expect(e10.items.map((i) => [i.id, i.amountCents])).toEqual(library);
    expect(e10.items.map((i) => i.percentE2)).toEqual(demo.result.items.map((i) => i.percentE2));
  });

  it('10 decimales representan 0,65/45 (0,0144444444) y el reparto sigue sumando el pozo', () => {
    const exact = computeProvisionalDistribution(34_799_000n, [
      row('supervisor', 48n, 144_444_444n),
      row('barra', 54n, 222_222_222n),
      row('bacha', 40n, 66_666_667n),
    ]);
    expect(exact.items.reduce((sum, i) => sum + i.amountCents, 0n)).toBe(34_799_000n);
  });

  it('cada empleado demo tiene un puesto conocido', () => {
    const ids = SEED_POSITIONS.map((p) => p.id);
    expect(SEED_STAFF.every((s) => ids.includes(s.positionId))).toBe(true);
  });
});
