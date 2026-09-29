import { describe, expect, it } from 'vitest';
import {
  applyAdvances,
  computePool,
  ParticipationError,
  participationWeight,
  spreadAdvances,
  type ParticipationMethod,
} from './participation';
import { computeProvisionalDistribution } from './provisional-formula';

/** Generador pseudoaleatorio con semilla (determinista: el mismo test da siempre lo mismo). */
function rng(seed: number) {
  let state = seed >>> 0;
  return (max: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % max;
  };
}

const weight = (
  hours: bigint,
  factorE4: bigint | null,
  pointsE2: bigint | null,
  m: ParticipationMethod,
) => participationWeight({ hoursE2: hours * 100n, factorE4, pointsE2 }, m);

describe('participationWeight: una función para los tres métodos (escala E8)', () => {
  it('BY_POSITION: horas × porción (los puntos no intervienen)', () => {
    // 45 h × 0,014 = 0,63 → 63.000.000 en E8
    expect(weight(45n, 140n, null, 'BY_POSITION')).toBe(63_000_000n);
    expect(weight(45n, 140n, 500n, 'BY_POSITION')).toBe(63_000_000n);
  });

  it('BY_POINTS: horas × puntos (la porción no interviene)', () => {
    // 40 h × 1,20 = 48 → 4.800.000.000 en E8
    expect(weight(40n, null, 120n, 'BY_POINTS')).toBe(4_800_000_000n);
    expect(weight(40n, 220n, 120n, 'BY_POINTS')).toBe(4_800_000_000n);
  });

  it('BY_POSITION_TIMES_POINTS: horas × porción × puntos', () => {
    // 40 h × 0,022 × 1,20 = 1,056 → 105.600.000 en E8
    expect(weight(40n, 220n, 120n, 'BY_POSITION_TIMES_POINTS')).toBe(105_600_000n);
  });

  it('pide lo que el método usa', () => {
    expect(() => weight(8n, null, 100n, 'BY_POSITION')).toThrow(ParticipationError);
    expect(() => weight(8n, 220n, null, 'BY_POINTS')).toThrow(ParticipationError);
    expect(() => weight(8n, 220n, 0n, 'BY_POSITION_TIMES_POINTS')).toThrow(ParticipationError);
    expect(() =>
      participationWeight({ hoursE2: -1n, factorE4: 1n, pointsE2: 1n }, 'BY_POSITION'),
    ).toThrow(ParticipationError);
  });
});

describe('computePool', () => {
  const pool = (total: bigint, weights: bigint[], unitCents = 1n) =>
    computePool(
      total,
      weights.map((w, i) => ({ id: `p${i}`, weightE8: w })),
      { unitCents },
    );

  it('mayor resto: la suma coincide exacto con el pozo', () => {
    expect(pool(100n, [1n, 1n, 1n]).shares.map((s) => s.amountCents)).toEqual([34n, 33n, 33n]);
  });

  it('en pesos enteros reparte pesos y exige un pozo sin centavos sueltos', () => {
    const result = pool(100_000n, [1n, 1n, 1n], 100n);
    expect(result.shares.map((s) => s.amountCents)).toEqual([33_400n, 33_300n, 33_300n]);
    expect(() => pool(100_050n, [1n], 100n)).toThrow(ParticipationError);
  });

  it('errores: pozo cero, sin ponderado, persona repetida', () => {
    expect(() => pool(0n, [1n])).toThrow(ParticipationError);
    expect(() => pool(100n, [0n, 0n])).toThrow(ParticipationError);
    expect(() =>
      computePool(100n, [
        { id: 'a', weightE8: 1n },
        { id: 'a', weightE8: 1n },
      ]),
    ).toThrow(ParticipationError);
  });
});

describe('casos aprobados (porción Camarero 0,022; pozo $ 100.000)', () => {
  const run = (method: ParticipationMethod, juanPoints: bigint, pedroPoints: bigint) =>
    computePool(10_000_000n, [
      { id: 'juan', weightE8: weight(40n, 220n, juanPoints, method) },
      { id: 'pedro', weightE8: weight(40n, 220n, pedroPoints, method) },
    ]).shares.map((s) => s.amountCents);

  it('caso 1: mismas horas y 1 punto cada uno → misma participación', () => {
    for (const method of ['BY_POSITION', 'BY_POINTS', 'BY_POSITION_TIMES_POINTS'] as const) {
      expect(run(method, 100n, 100n)).toEqual([5_000_000n, 5_000_000n]);
    }
  });

  it('casos 2 y 4: Juan 1,20 y Pedro 1,00 (mismo puesto y turno) → Juan cobra más', () => {
    // 1,056 / 1,936 del pozo → $ 54.545,45 y $ 45.454,55 (el centavo va al mayor resto: Pedro)
    expect(run('BY_POSITION_TIMES_POINTS', 120n, 100n)).toEqual([5_454_545n, 4_545_455n]);
    // Dentro de un mismo puesto, BY_POINTS da lo mismo (la porción se cancela).
    expect(run('BY_POINTS', 120n, 100n)).toEqual([5_454_545n, 4_545_455n]);
    // BY_POSITION ignora los puntos.
    expect(run('BY_POSITION', 120n, 100n)).toEqual([5_000_000n, 5_000_000n]);
  });
});

describe('propiedad: BY_POSITION da EXACTAMENTE lo mismo que la fórmula actual', () => {
  it('importes, participación y adelantos idénticos en 500 repartos aleatorios', () => {
    const next = rng(20260929);
    for (let run = 0; run < 500; run += 1) {
      const count = 1 + next(15);
      const rows = Array.from({ length: count }, (_, i) => ({
        id: `e${i}`,
        hoursE2: BigInt(next(16_801)),
        factorE4: BigInt(1 + next(500)),
        advanceCents: next(3) === 0 ? BigInt(next(5_000_000)) : 0n,
      }));
      if (rows.every((r) => r.hoursE2 === 0n)) rows[0] = { ...rows[0]!, hoursE2: 100n };
      const unitCents = next(2) === 0 ? 1n : 100n;
      const totalCents = BigInt(1 + next(50_000_000)) * unitCents;

      const expected = computeProvisionalDistribution(totalCents, rows, { unitCents });
      const pool = computePool(
        totalCents,
        rows.map((r) => ({
          id: r.id,
          weightE8: participationWeight(
            { hoursE2: r.hoursE2, factorE4: r.factorE4, pointsE2: null },
            'BY_POSITION',
          ),
        })),
        { unitCents },
      );
      const advances = applyAdvances(
        rows.map((r, i) => ({
          id: r.id,
          grossCents: pool.shares[i]!.amountCents,
          pendingCents: r.advanceCents,
        })),
      );
      expect(pool.totalWeightE8).toBe(expected.totalPointsE6 * 100n);
      expect(pool.shares.map((s) => s.amountCents)).toEqual(
        expected.items.map((i) => i.amountCents),
      );
      expect(pool.shares.map((s) => s.percentE2)).toEqual(expected.items.map((i) => i.percentE2));
      expect(pool.shares.map((s) => s.weightE8)).toEqual(
        expected.items.map((i) => i.pointsE6 * 100n),
      );
      expect(advances.map((a) => a.appliedCents)).toEqual(
        expected.items.map((i) => i.advanceAppliedCents),
      );
      expect(advances.map((a) => a.remainingCents)).toEqual(
        expected.items.map((i) => i.pendingAdvanceCents),
      );
      expect(advances.map((a) => a.finalCents)).toEqual(expected.items.map((i) => i.finalCents));
    }
  });

  it('BY_POSITION_TIMES_POINTS con todos en 1,00 = BY_POSITION', () => {
    const next = rng(7);
    for (let run = 0; run < 300; run += 1) {
      const rows = Array.from({ length: 1 + next(12) }, (_, i) => ({
        id: `e${i}`,
        hoursE2: BigInt(1 + next(16_800)),
        factorE4: BigInt(1 + next(500)),
      }));
      const total = BigInt(1 + next(90_000_000));
      const amounts = (method: ParticipationMethod) =>
        computePool(
          total,
          rows.map((r) => ({
            id: r.id,
            weightE8: participationWeight({ ...r, pointsE2: 100n }, method),
          })),
        ).shares.map((s) => s.amountCents);
      expect(amounts('BY_POSITION_TIMES_POINTS')).toEqual(amounts('BY_POSITION'));
    }
  });

  it('con un solo puesto, BY_POSITION_TIMES_POINTS = BY_POINTS (la porción se cancela)', () => {
    const next = rng(11);
    for (let run = 0; run < 300; run += 1) {
      const factorE4 = BigInt(1 + next(500));
      const rows = Array.from({ length: 1 + next(12) }, (_, i) => ({
        id: `e${i}`,
        hoursE2: BigInt(1 + next(16_800)),
        factorE4,
        pointsE2: BigInt(1 + next(300)),
      }));
      const total = BigInt(1 + next(90_000_000));
      const amounts = (method: ParticipationMethod) =>
        computePool(
          total,
          rows.map((r) => ({ id: r.id, weightE8: participationWeight(r, method) })),
        ).shares.map((s) => s.amountCents);
      expect(amounts('BY_POSITION_TIMES_POINTS')).toEqual(amounts('BY_POINTS'));
    }
  });

  it('cualquier método: la suma es exacta, sin negativos, en la unidad pedida', () => {
    const next = rng(99);
    const methods: ParticipationMethod[] = ['BY_POSITION', 'BY_POINTS', 'BY_POSITION_TIMES_POINTS'];
    for (let run = 0; run < 300; run += 1) {
      const method = methods[next(3)]!;
      const unitCents = next(2) === 0 ? 1n : 100n;
      const total = BigInt(1 + next(90_000_000)) * unitCents;
      const rows = Array.from({ length: 1 + next(12) }, (_, i) => ({
        id: `e${i}`,
        weightE8: participationWeight(
          {
            hoursE2: BigInt(1 + next(2_400)),
            factorE4: BigInt(1 + next(500)),
            pointsE2: BigInt(1 + next(300)),
          },
          method,
        ),
      }));
      const shares = computePool(total, rows, { unitCents }).shares;
      expect(shares.reduce((sum, s) => sum + s.amountCents, 0n)).toBe(total);
      expect(shares.every((s) => s.amountCents >= 0n && s.amountCents % unitCents === 0n)).toBe(
        true,
      );
    }
  });
});

describe('adelantos: por persona sobre el bruto total', () => {
  it('se descuenta hasta el bruto y el resto queda pendiente', () => {
    expect(
      applyAdvances([
        { id: 'a', grossCents: 3_000_000n, pendingCents: 4_000_000n },
        { id: 'b', grossCents: 5_000_000n, pendingCents: 1_000_000n },
        { id: 'c', grossCents: 0n, pendingCents: 700n },
      ]),
    ).toEqual([
      {
        id: 'a',
        grossCents: 3_000_000n,
        appliedCents: 3_000_000n,
        remainingCents: 1_000_000n,
        finalCents: 0n,
      },
      {
        id: 'b',
        grossCents: 5_000_000n,
        appliedCents: 1_000_000n,
        remainingCents: 0n,
        finalCents: 4_000_000n,
      },
      { id: 'c', grossCents: 0n, appliedCents: 0n, remainingCents: 700n, finalCents: 0n },
    ]);
    expect(() => applyAdvances([{ id: 'x', grossCents: -1n, pendingCents: 0n }])).toThrow(
      ParticipationError,
    );
  });

  it('spreadAdvances llena los ítems en orden, nunca más que su importe', () => {
    const spread = spreadAdvances(
      [
        { key: 'lun-mañana', amountCents: 9_485_030n },
        { key: 'lun-noche', amountCents: 7_811_321n },
        { key: 'mar-mañana', amountCents: 1_000n },
      ],
      10_000_000n,
    );
    expect(spread.map((s) => s.advanceCents)).toEqual([9_485_030n, 514_970n, 0n]);
    expect(spread.map((s) => s.finalCents)).toEqual([0n, 7_296_351n, 1_000n]);
    expect(spread.reduce((sum, s) => sum + s.advanceCents, 0n)).toBe(10_000_000n);
  });

  it('spreadAdvances rechaza aplicar más de lo que la persona cobra', () => {
    expect(() => spreadAdvances([{ key: 'a', amountCents: 10n }], 11n)).toThrow(ParticipationError);
    expect(spreadAdvances([], 0n)).toEqual([]);
  });
});
