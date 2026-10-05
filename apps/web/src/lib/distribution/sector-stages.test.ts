import { describe, expect, it } from 'vitest';
import { buildPeriodPreview, type PreviewPerson } from './period-preview';
import { parseSectorSnapshot, stagesToView } from './sector-snapshot';
import {
  checkStages,
  computeStages,
  formatStagePercent,
  parseStagePercent,
  unassignedCents,
  type SectorAssignment,
} from './sector-stages';

/** Generador pseudoaleatorio con semilla (determinista: el mismo test da siempre lo mismo). */
function rng(seed: number) {
  let state = seed >>> 0;
  return (max: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % max;
  };
}

const sector = (
  id: string,
  stage: number | null,
  percent: string | null,
  name = id,
): SectorAssignment => ({ id, name, stage, percent });

/** El caso del pedido: Cocina 30 % del total; Salón, Barra y Supervisores sobre el saldo; Bacha. */
const RESTAURANT = [
  sector('cocina', 1, '30', 'Cocina'),
  sector('salon', 2, '50', 'Salón'),
  sector('barra', 2, '25', 'Barra'),
  sector('super', 2, '15', 'Supervisores'),
  sector('bacha', 3, '100', 'Bacha'),
];

function plan(sectors: readonly SectorAssignment[]) {
  const check = checkStages(sectors);
  if (!check.ok) throw new Error(check.errors.join(' '));
  return check.stages;
}

const amounts = (stages: ReturnType<typeof computeStages>) =>
  Object.fromEntries(stages.flatMap((s) => s.sectors).map((s) => [s.id, s.amountCents]));

describe('porcentajes de etapa', () => {
  it('acepta números > 0 y ≤ 100 con hasta 2 decimales', () => {
    expect(parseStagePercent('30')).toBe(3000n);
    expect(parseStagePercent('12,5')).toBe(1250n);
    expect(parseStagePercent('33.33 %')).toBe(3333n);
    expect(parseStagePercent('100')).toBe(10000n);
    for (const bad of ['0', '100,01', '-5', 'abc', '', '1,234', null]) {
      expect({ bad, value: parseStagePercent(bad) }).toEqual({ bad, value: null });
    }
    expect(formatStagePercent(1250n)).toBe('12,5');
    expect(formatStagePercent(10000n)).toBe('100');
  });
});

describe('validación de la configuración por etapas', () => {
  it('ordena las etapas: la 1 sobre el total y las demás sobre el saldo', () => {
    const stages = plan(RESTAURANT);
    expect(stages.map((s) => [s.number, s.base, s.sumE2])).toEqual([
      [1, 'TOTAL', 3000n],
      [2, 'REMAINDER', 9000n],
      [3, 'REMAINDER', 10000n],
    ]);
  });

  it('exige etapa y porcentaje de cada sector, con mensajes claros', () => {
    const check = checkStages([
      sector('cocina', 1, '30', 'Cocina'),
      sector('salon', null, '70', 'Salón'),
      sector('bacha', 2, null, 'Bacha'),
      sector('barra', 2, '150', 'Barra'),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors).toEqual([
      'Salón: elegí en qué etapa cobra.',
      'Bacha: falta el porcentaje.',
      'Barra: el porcentaje tiene que ser un número mayor que 0 y hasta 100 (hasta 2 decimales).',
    ]);
  });

  it('la última etapa suma hasta 100 % (menos es válido: el resto queda sin asignar)', () => {
    expect(checkStages([sector('cocina', 1, '30', 'Cocina'), sector('salon', 2, '60')]).ok).toBe(
      true,
    );
    const over = checkStages([sector('a', 1, '70'), sector('b', 1, '40')]);
    expect(over.ok ? [] : over.errors).toEqual([
      'La última etapa (1) suma 110 % del total: no puede pasar de 100 % (sobran 10 %).',
    ]);
  });

  it('una etapa intermedia tiene que dejar saldo y las etapas no tienen saltos', () => {
    const full = checkStages([sector('cocina', 1, '100'), sector('salon', 2, '100')]);
    expect(full.ok ? [] : full.errors).toEqual([
      'La etapa 1 suma 100 % del total y después viene la etapa 2: tiene que sumar menos de 100 % para que quede saldo.',
    ]);
    const gap = checkStages([sector('cocina', 1, '30'), sector('salon', 3, '100')]);
    expect(gap.ok ? [] : gap.errors).toEqual([
      'La etapa 2 no tiene ningún sector: numerá las etapas 1, 2, 3… sin saltos.',
    ]);
    expect(checkStages([]).ok).toBe(false);
  });
});

describe('cálculo por etapas', () => {
  it('ejemplo del pedido: $100.000, cocina 30 % del total → los demás sobre $70.000', () => {
    const stages = computeStages(10_000_000n, plan(RESTAURANT));
    expect(stages.map((s) => [s.baseCents, s.amountCents, s.remainderCents])).toEqual([
      [10_000_000n, 3_000_000n, 7_000_000n], // Cocina: 30 % de $100.000
      [7_000_000n, 6_300_000n, 700_000n], // 90 % de $70.000; quedan $7.000
      [700_000n, 700_000n, 0n], // Bacha: 100 % del saldo
    ]);
    expect(amounts(stages)).toEqual({
      cocina: 3_000_000n,
      salon: 3_500_000n, // 50 % de $70.000 (no de $100.000)
      barra: 1_750_000n,
      super: 1_050_000n,
      bacha: 700_000n,
    });
  });

  it('caso pedido: $100.000, cocina 30 %, salón 90 % de $70.000, bacha 100 % del remanente', () => {
    const stages = computeStages(
      10_000_000n,
      plan([
        sector('cocina', 1, '30', 'Cocina'),
        sector('salon', 2, '90', 'Salón'),
        sector('bacha', 3, '100', 'Bacha'),
      ]),
    );
    expect(
      stages.map((s) => [
        s.number,
        s.base,
        s.baseCents,
        s.percentE2,
        s.amountCents,
        s.remainderCents,
      ]),
    ).toEqual([
      [1, 'TOTAL', 10_000_000n, 3000n, 3_000_000n, 7_000_000n], // Cocina: 30 % de $100.000
      [2, 'REMAINDER', 7_000_000n, 9000n, 6_300_000n, 700_000n], // Salón: 90 % de $70.000
      [3, 'REMAINDER', 700_000n, 10000n, 700_000n, 0n], // Bacha: 100 % de $7.000
    ]);
    expect(amounts(stages)).toEqual({ cocina: 3_000_000n, salon: 6_300_000n, bacha: 700_000n });
    expect(unassignedCents(stages)).toBe(0n);
  });

  it('salón repartido en camareros, barra y supervisores: cada uno sobre los $70.000', () => {
    const stages = computeStages(
      10_000_000n,
      plan([
        sector('cocina', 1, '30', 'Cocina'),
        sector('salon', 2, '60', 'Camareros'),
        sector('barra', 2, '20', 'Barra'),
        sector('super', 2, '10', 'Supervisores'),
        sector('bacha', 3, '100', 'Bacha'),
      ]),
    );
    expect(amounts(stages)).toEqual({
      cocina: 3_000_000n,
      salon: 4_200_000n, // 60 % de $70.000
      barra: 1_400_000n, // 20 % de $70.000
      super: 700_000n, // 10 % de $70.000
      bacha: 700_000n, // 100 % de los $7.000 que quedan
    });
    expect(stages[1]?.amountCents).toBe(6_300_000n);
  });

  it('bacha con menos de 100 %: usa su porcentaje y el resto queda sin asignar (no se mueve)', () => {
    const stages = computeStages(
      10_000_000n,
      plan([
        sector('cocina', 1, '30', 'Cocina'),
        sector('salon', 2, '90', 'Salón'),
        sector('bacha', 3, '50', 'Bacha'),
      ]),
    );
    expect(amounts(stages)).toEqual({ cocina: 3_000_000n, salon: 6_300_000n, bacha: 350_000n });
    expect(stages[2]?.baseCents).toBe(700_000n); // la base sigue siendo el remanente de $7.000
    expect(unassignedCents(stages)).toBe(350_000n);
    const all = stages.flatMap((s) => s.sectors).reduce((sum, s) => sum + s.amountCents, 0n);
    expect(all + unassignedCents(stages)).toBe(10_000_000n);
  });

  it('la suma de los sectores es siempre el total exacto, en la unidad de redondeo', () => {
    const next = rng(20261004);
    for (let run = 0; run < 500; run += 1) {
      const unit = next(2) === 0 ? 1n : 100n;
      const total = BigInt(1 + next(1_000_000_000)) * unit;
      // Etapa 1: 1 a 3 sectores que suman < 100 %. Etapa 2: 1 a 4 sectores que suman 100 %.
      const first = Array.from({ length: 1 + next(3) }, () => BigInt(1 + next(3_000)));
      const rest = Array.from({ length: next(4) }, () => BigInt(1 + next(2_000)));
      const lastPart = 10_000n - rest.reduce((a, b) => a + b, 0n);
      if (lastPart <= 0n) continue;
      const stages = plan([
        ...first.map((p, i) => sector(`a${i}`, 1, formatStagePercent(p))),
        ...[...rest, lastPart].map((p, i) => sector(`b${i}`, 2, formatStagePercent(p))),
      ]);
      const result = computeStages(total, stages, unit);
      const all = result.flatMap((x) => x.sectors);
      expect(all.reduce((a, s) => a + s.amountCents, 0n)).toBe(total);
      for (const s of all) expect(s.amountCents % unit).toBe(0n);
      expect(result[1]?.baseCents).toBe(result[0]?.remainderCents);
      expect(result[1]?.remainderCents).toBe(0n);
    }
  });
});

describe('reparto de un período por sectores', () => {
  const person = (
    employeeId: string,
    positionId: string,
    hours: string | null,
    advanceCents = 0n,
  ): PreviewPerson => ({
    employeeId,
    name: employeeId,
    positionId,
    positionName: RESTAURANT.find((s) => s.id === positionId)?.name ?? null,
    factor: '0,02',
    hours,
    advanceCents,
    active: true,
  });
  const people = [
    person('ana', 'cocina', '40'),
    person('beto', 'cocina', '20'),
    person('carla', 'salon', '45'),
    person('dani', 'barra', '30', 500_000n),
    person('eli', 'super', '45'),
    person('fede', 'bacha', '35'),
  ];

  it('cada sector reparte su monto entre su gente por horas, con adelantos', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: RESTAURANT,
      people,
    });
    expect(preview.issues).toEqual([]);
    expect(preview.canClose).toBe(true);
    const amount = Object.fromEntries(preview.rows.map((r) => [r.employeeId, r.amountCents]));
    expect(amount).toEqual({
      ana: 2_000_000n, // 40 de 60 h de los $30.000 de Cocina
      beto: 1_000_000n,
      carla: 3_500_000n,
      dani: 1_750_000n,
      eli: 1_050_000n,
      fede: 700_000n,
    });
    expect(preview.rows.find((r) => r.employeeId === 'dani')?.finalCents).toBe(1_250_000n);
    expect(preview.totalFinalCents).toBe(10_000_000n - 500_000n);
    // La participación es sobre el total: Ana cobra el 20 %.
    expect(preview.rows.find((r) => r.employeeId === 'ana')?.percentE2).toBe(2000n);
    expect(preview.sectors?.people.get('cocina')).toBe(2);
    expect(preview.hourValues.find((h) => h.positionName === 'Cocina')?.centsPerHour).toBe(50_000n);
  });

  it('caso pedido en el cierre: cocina $30.000, salón $63.000 y bacha $7.000', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 100n,
      sectors: [
        sector('cocina', 1, '30', 'Cocina'),
        sector('salon', 2, '90', 'Salón'),
        sector('bacha', 3, '100', 'Bacha'),
      ],
      people: [
        person('ana', 'cocina', '40'),
        person('carla', 'salon', '45'),
        person('fede', 'bacha', '35'),
      ],
    });
    expect(preview.issues).toEqual([]);
    expect(preview.canClose).toBe(true);
    expect(Object.fromEntries(preview.rows.map((r) => [r.employeeId, r.amountCents]))).toEqual({
      ana: 3_000_000n,
      carla: 6_300_000n,
      fede: 700_000n,
    });
  });

  it('con plata sin asignar muestra cuánto y no deja cerrar (no la reparte a nadie)', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: RESTAURANT.map((s) => (s.id === 'bacha' ? { ...s, percent: '50' } : s)),
      people,
    });
    expect(preview.canClose).toBe(false);
    expect(preview.rows.find((r) => r.employeeId === 'fede')?.amountCents).toBe(350_000n);
    expect(preview.rows.find((r) => r.employeeId === 'carla')?.amountCents).toBe(3_500_000n);
    expect(unassignedCents(preview.sectors?.stages ?? [])).toBe(350_000n);
    expect(preview.issues.map((i) => i.message)).toEqual([
      'Quedan $ 3.500,00 sin asignar: la etapa 3 reparte el 50 % de $ 7.000,00. Esa plata no pasa a ningún sector. Para cerrar, ajustá los porcentajes en Configuración (la última etapa tiene que repartir el 100 %).',
    ]);
  });

  it('con la configuración incompleta no calcula y dice qué falta', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: [sector('cocina', 1, '30', 'Cocina'), sector('salon', 2, null, 'Salón')],
      people,
    });
    expect(preview.computed).toBe(false);
    expect(preview.canClose).toBe(false);
    expect(preview.issues.map((i) => i.code)).toContain('SECTORS_CONFIG');
    expect(preview.issues.find((i) => i.code === 'SECTORS_CONFIG')?.message).toContain(
      'Salón: falta el porcentaje.',
    );
  });

  it('un sector con monto y sin nadie con horas bloquea el cierre (la plata no pasa a otro)', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: RESTAURANT,
      people: people.map((p) => (p.positionId === 'bacha' ? { ...p, hours: '0' } : p)),
    });
    expect(preview.canClose).toBe(false);
    expect(preview.issues.find((i) => i.code === 'EMPTY_SECTOR')?.message).toContain(
      'Nadie de Bacha tiene horas y le corresponden $ 7.000,00.',
    );
  });

  it('el snapshot guardado se vuelve a leer igual (lo usa el historial)', () => {
    const stages = computeStages(10_000_000n, plan(RESTAURANT));
    const view = stagesToView(stages, new Map([['cocina', 2]]));
    expect(parseSectorSnapshot(JSON.parse(JSON.stringify({ sectorStages: view })))).toEqual(view);
    expect(parseSectorSnapshot({ number: 3 })).toBeNull();
    expect(parseSectorSnapshot({ sectorStages: [{ number: 'x' }] })).toBeNull();
  });
});
