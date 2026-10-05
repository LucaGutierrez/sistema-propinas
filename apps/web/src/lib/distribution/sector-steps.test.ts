import { describe, expect, it } from 'vitest';
import { buildPeriodPreview, type PreviewPerson, type SectorConfig } from './period-preview';
import { parseSectorSnapshot, sectorOnlyCents, sectorPools, stepsToView } from './sector-snapshot';
import {
  checkSectors,
  computeSectors,
  formatSectorPercent,
  fractionPercentText,
  partialSectors,
  sectorsLeftover,
  sectorsSummary,
  type SectorBase,
  type SectorInput,
} from './sector-steps';

/** Generador pseudoaleatorio con semilla (determinista: el mismo test da siempre lo mismo). */
function rng(seed: number) {
  let state = seed >>> 0;
  return (max: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % max;
  };
}

/** Puestos del restaurante (con su porción, la de "Puestos y porciones"). */
const POSITIONS = [
  { id: 'cocinero', name: 'Cocinero', factor: '0,02' },
  { id: 'camarero', name: 'Camarero', factor: '0,022' },
  { id: 'supervisor', name: 'Supervisor', factor: '0,014' },
  { id: 'barra', name: 'Barra', factor: '0,022' },
  { id: 'bacha', name: 'Bacha', factor: '0,007' },
];

const sector = (
  id: string,
  base: SectorBase,
  percent: string | null,
  positionIds: string[] = [],
  name = id,
): SectorInput => ({ id, name, base, percent, positionIds });

/** El caso del pedido: Cocina 30 % del total, Salón 50 % del saldo, Bacha el resto. */
const PEDIDO = [
  sector('cocina', 'TOTAL', '30', ['cocinero'], 'Cocina'),
  sector('salon', 'REMAINDER', '50', ['camarero', 'supervisor', 'barra'], 'Salón'),
  sector('bacha', 'REMAINDER', '100', ['bacha'], 'Bacha'),
];

function plan(sectors: readonly SectorInput[]) {
  const check = checkSectors(sectors, POSITIONS);
  if (!check.ok) throw new Error(check.errors.join(' '));
  return check.sectors;
}

const steps = (results: ReturnType<typeof computeSectors>) =>
  results.map((r) => [r.name, r.base, r.baseCents, r.amountCents, r.leftAfterCents]);

describe('cálculo por sectores, paso a paso', () => {
  it('ejemplo del pedido con $100.000: Cocina $30.000, quedan $70.000, Salón 50 % = $35.000', () => {
    const results = computeSectors(10_000_000n, plan(PEDIDO));
    expect(steps(results)).toEqual([
      ['Cocina', 'TOTAL', 10_000_000n, 3_000_000n, 7_000_000n], // 30 % de $100.000
      ['Salón', 'REMAINDER', 7_000_000n, 3_500_000n, 3_500_000n], // 50 % de $70.000
      ['Bacha', 'REMAINDER', 3_500_000n, 3_500_000n, 0n], // 100 % de lo que queda
    ]);
    expect(sectorsLeftover(10_000_000n, results)).toBe(0n);
  });

  it('Bacha sobre el TOTAL original: 10 % de $100.000 = $10.000 y quedan $25.000 sin asignar', () => {
    const results = computeSectors(
      10_000_000n,
      plan(PEDIDO.map((s) => (s.id === 'bacha' ? { ...s, base: 'TOTAL', percent: '10' } : s))),
    );
    expect(results[2]).toMatchObject({
      base: 'TOTAL',
      baseCents: 10_000_000n, // la base es el total original, no el saldo
      availableCents: 3_500_000n,
      amountCents: 1_000_000n,
      leftAfterCents: 2_500_000n,
    });
    expect(sectorsLeftover(10_000_000n, results)).toBe(2_500_000n);
  });

  it('Bacha sobre el SALDO: 20 % de $35.000 = $7.000 y quedan $28.000 sin asignar', () => {
    const results = computeSectors(
      10_000_000n,
      plan(PEDIDO.map((s) => (s.id === 'bacha' ? { ...s, percent: '20' } : s))),
    );
    expect(results[2]).toMatchObject({ baseCents: 3_500_000n, amountCents: 700_000n });
    expect(sectorsLeftover(10_000_000n, results)).toBe(2_800_000n);
    const check = checkSectors(
      PEDIDO.map((s) => (s.id === 'bacha' ? { ...s, percent: '20' } : s)),
      POSITIONS,
    );
    // 0,7 × 0,5 × 0,8 = 28 % del total queda sin asignar.
    expect(check.ok && fractionPercentText(check.leftover)).toBe('28');
  });

  it('el primer sector siempre parte del total, aunque diga "saldo"', () => {
    const [first] = plan([
      sector('cocina', 'REMAINDER', '30'),
      sector('resto', 'REMAINDER', '100'),
    ]);
    expect(first?.base).toBe('TOTAL');
  });

  it('la suma de los sectores más lo sin asignar es siempre el total, en la unidad', () => {
    const next = rng(20261005);
    for (let run = 0; run < 500; run += 1) {
      const unit = next(2) === 0 ? 1n : 100n;
      const total = BigInt(1 + next(1_000_000_000)) * unit;
      const list = Array.from({ length: 1 + next(5) }, (_, i) =>
        sector(
          `s${i}`,
          next(3) === 0 ? 'TOTAL' : 'REMAINDER',
          formatSectorPercent(BigInt(1 + next(4_000))),
        ),
      );
      const check = checkSectors(list, POSITIONS);
      if (!check.ok) continue;
      const results = computeSectors(total, check.sectors, unit);
      const assigned = results.reduce((sum, r) => sum + r.amountCents, 0n);
      expect(assigned + sectorsLeftover(total, results)).toBe(total);
      for (const r of results) {
        expect(r.amountCents % unit).toBe(0n);
        expect(r.amountCents <= r.availableCents).toBe(true);
      }
    }
  });
});

describe('validación de los sectores', () => {
  it('un sector "del total" no puede pedir más de lo que queda', () => {
    const check = checkSectors(
      [
        sector('cocina', 'TOTAL', '30', [], 'Cocina'),
        sector('salon', 'REMAINDER', '50', [], 'Salón'),
        sector('bacha', 'TOTAL', '40', [], 'Bacha'),
      ],
      POSITIONS,
    );
    expect(check.ok ? [] : check.errors).toEqual([
      'Bacha pide el 40 % del total, pero en ese paso solo queda el 35 % del total. Bajá su porcentaje o calculalo sobre el saldo.',
    ]);
  });

  it('nombre, porcentaje y puestos, con mensajes claros', () => {
    const check = checkSectors(
      [
        sector('a', 'TOTAL', '30', ['cocinero'], ''),
        sector('b', 'REMAINDER', null, ['cocinero'], 'Salón'),
        sector('c', 'REMAINDER', '150', [], 'salón'),
        sector('d', 'REMAINDER', '10', ['no-existe'], 'Bacha'),
      ],
      POSITIONS,
    );
    expect(check.ok ? [] : check.errors).toEqual([
      'El sector 1: poné un nombre (por ejemplo, Cocina).',
      'Salón: falta el porcentaje.',
      'Cocinero está en El sector 1 y en Salón: un puesto va en un solo sector.',
      'Hay dos sectores que se llaman "salón": cambiale el nombre a uno.',
      'salón: el porcentaje tiene que ser un número mayor que 0 y hasta 100 (hasta 2 decimales).',
      'Bacha: uno de sus puestos ya no existe. Recargá la página.',
    ]);
    expect(checkSectors([], POSITIONS).ok).toBe(false);
  });

  it('resumen en vivo: calcula los primeros pasos completos y corta en el primero incompleto', () => {
    const partial = partialSectors([
      sector('cocina', 'TOTAL', '30'),
      sector('salon', 'REMAINDER', '50'),
      sector('bacha', 'REMAINDER', ''),
      sector('otro', 'REMAINDER', '100'),
    ]);
    expect(partial.map((s) => s.id)).toEqual(['cocina', 'salon']);
    expect(partialSectors([sector('a', 'TOTAL', '80'), sector('b', 'TOTAL', '30')])).toHaveLength(
      1,
    );
  });

  it('resumen de la versión con los puestos de cada sector', () => {
    const names = new Map(POSITIONS.map((p) => [p.id, p.name]));
    expect(sectorsSummary(plan(PEDIDO), (id) => names.get(id) ?? '?')).toBe(
      'Cocina 30 % del total (Cocinero) · Salón 50 % del saldo (Camarero, Supervisor, Barra) · Bacha 100 % del saldo (Bacha)',
    );
  });
});

describe('reparto de un período por sectores', () => {
  const person = (
    employeeId: string,
    positionId: string,
    hours: string | null,
    extra: Partial<PreviewPerson> = {},
  ): PreviewPerson => {
    const position = POSITIONS.find((p) => p.id === positionId);
    return {
      employeeId,
      name: employeeId,
      positionId,
      positionName: position?.name ?? null,
      factor: position?.factor ?? null,
      hours,
      advanceCents: 0n,
      active: true,
      ...extra,
    };
  };
  const config = (sectors: readonly SectorInput[]): SectorConfig => ({
    sectors,
    positions: POSITIONS,
  });
  const team = [
    person('ana', 'cocinero', '40'),
    person('beto', 'cocinero', '20'),
    person('carla', 'camarero', '45'),
    person('dani', 'barra', '30', { advanceCents: 500_000n }),
    person('eli', 'supervisor', '45'),
    person('fede', 'bacha', '35'),
  ];
  const amounts = (preview: ReturnType<typeof buildPeriodPreview>) =>
    Object.fromEntries(preview.rows.map((r) => [r.employeeId, r.amountCents]));

  it('$100.000: Cocina $30.000, Salón $35.000 y Bacha $35.000, cada uno entre su gente', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: config(PEDIDO),
      people: team,
    });
    expect(preview.issues).toEqual([]);
    expect(preview.canClose).toBe(true);
    expect(preview.sectors?.steps.map((s) => [s.name, s.amountCents, s.people])).toEqual([
      ['Cocina', '3000000', 2],
      ['Salón', '3500000', 3],
      ['Bacha', '3500000', 1],
    ]);
    const amount = amounts(preview);
    expect(amount.ana).toBe(2_000_000n); // 40 de 60 h de los $30.000 de Cocina
    expect(amount.beto).toBe(1_000_000n);
    expect(amount.fede).toBe(3_500_000n);
    expect((amount.carla ?? 0n) + (amount.dani ?? 0n) + (amount.eli ?? 0n)).toBe(3_500_000n);
    expect(preview.totalFinalCents).toBe(10_000_000n - 500_000n);
    expect(preview.sectorOnlyCents).toBe(0n);
  });

  it('dentro de Salón usa el MISMO cálculo de siempre: porción, horas y puntos de cada persona', () => {
    const salon = team.filter((p) =>
      ['camarero', 'barra', 'supervisor'].includes(p.positionId ?? ''),
    );
    for (const method of ['BY_POSITION', 'BY_POSITION_TIMES_POINTS'] as const) {
      const withPoints = salon.map((p, i) => ({ ...p, individualPoints: ['1', '1,2', '0,8'][i] }));
      const bySectors = buildPeriodPreview({
        totalCents: 10_000_000n,
        unitCents: 1n,
        method,
        sectors: config(PEDIDO),
        people: [...team.filter((p) => !salon.includes(p)), ...withPoints],
      });
      // Pozo único con solo la gente de Salón y $35.000: tiene que dar exactamente lo mismo.
      const alone = buildPeriodPreview({
        totalCents: 3_500_000n,
        unitCents: 1n,
        method,
        people: withPoints,
      });
      const salonAmounts = bySectors.rows
        .filter((r) => salon.some((p) => p.employeeId === r.employeeId))
        .map((r) => [r.employeeId, r.amountCents, r.weightE8]);
      expect(salonAmounts).toEqual(
        alone.rows.map((r) => [r.employeeId, r.amountCents, r.weightE8]),
      );
    }
  });

  it('un sector sin puestos cobra entero: no va a sobres de personas', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 100n,
      sectors: config(PEDIDO.map((s) => (s.id === 'cocina' ? { ...s, positionIds: [] } : s))),
      people: team.filter((p) => p.positionId !== 'cocinero'),
    });
    expect(preview.canClose).toBe(true);
    expect(preview.sectorOnlyCents).toBe(3_000_000n);
    expect(preview.sectors?.steps[0]).toMatchObject({ positions: [], people: 0 });
    // Sobres: los $70.000 que quedan, menos el adelanto de Dani.
    expect(preview.totalFinalCents).toBe(7_000_000n - 500_000n);
    expect(preview.sectors && sectorOnlyCents({ kind: 'steps', ...preview.sectors })).toBe(
      3_000_000n,
    );
  });

  it('con plata sin asignar dice cuánto y cómo resolverlo, y no deja cerrar', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: config(
        PEDIDO.map((s) => (s.id === 'bacha' ? { ...s, base: 'TOTAL', percent: '10' } : s)),
      ),
      people: team,
    });
    expect(preview.canClose).toBe(false);
    expect(amounts(preview).fede).toBe(1_000_000n); // Bacha: 10 % del total, nada más
    expect(preview.sectors?.unassignedCents).toBe('2500000');
    expect(preview.issues.map((i) => i.message)).toEqual([
      'Quedan $ 25.000,00 sin asignar: después de Bacha (10 % del total original) sobra plata que no es de ningún sector. Para cerrar, en Configuración → Reparto por sectores subí el porcentaje del último sector (100 % del saldo se lleva todo lo que queda) o agregá un sector para ese saldo.',
    ]);
  });

  it('quien trabaja en un puesto sin sector bloquea el cierre (no cobra de otro lado)', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: config(PEDIDO.map((s) => (s.id === 'bacha' ? { ...s, positionIds: [] } : s))),
      people: team,
    });
    expect(preview.canClose).toBe(false);
    expect(preview.issues.find((i) => i.code === 'NO_SECTOR')).toMatchObject({
      message:
        'fede tiene horas, pero su puesto (Bacha) no está en ningún sector. Agregalo a un sector en Configuración → Reparto por sectores, o poné 0 horas si no cobra.',
      employeeIds: ['fede'],
    });
  });

  it('un sector con puestos y sin nadie con horas bloquea el cierre', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: config(PEDIDO),
      people: team.map((p) => (p.positionId === 'bacha' ? { ...p, hours: '0' } : p)),
    });
    expect(preview.canClose).toBe(false);
    expect(preview.issues.find((i) => i.code === 'EMPTY_SECTOR')?.message).toContain(
      'Nadie de Bacha tiene horas y le corresponden $ 35.000,00.',
    );
  });

  it('una versión del formato anterior pide volver a guardar los sectores', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      sectors: { sectors: [], positions: POSITIONS, legacy: true },
      people: team,
    });
    expect(preview.computed).toBe(false);
    expect(preview.issues.map((i) => i.code)).toContain('SECTORS_CONFIG');
  });
});

describe('snapshot del cierre', () => {
  it('se vuelve a leer igual (lo usa el historial) y arma los pozos de cada sector', () => {
    const names = new Map(POSITIONS.map((p) => [p.id, p.name]));
    const view = stepsToView(
      10_000_000n,
      computeSectors(10_000_000n, plan(PEDIDO)),
      (id) => names.get(id) ?? '?',
      new Map([['salon', 3]]),
    );
    const read = parseSectorSnapshot(JSON.parse(JSON.stringify({ sectorSteps: view })));
    expect(read).toEqual({ kind: 'steps', ...view });
    expect(read && sectorPools(read).map((p) => [p.name, p.amountCents, p.positionNames])).toEqual([
      ['Cocina', 3_000_000n, ['Cocinero']],
      ['Salón', 3_500_000n, ['Camarero', 'Supervisor', 'Barra']],
      ['Bacha', 3_500_000n, ['Bacha']],
    ]);
  });

  it('los repartos viejos (por etapas) se siguen leyendo', () => {
    const stages = [
      {
        number: 1,
        base: 'TOTAL',
        baseCents: '10000000',
        percentE2: '3000',
        amountCents: '3000000',
        remainderCents: '7000000',
        sectors: [
          { id: 'c', name: 'Cocina', percentE2: '3000', amountCents: '3000000', people: 2 },
        ],
      },
    ];
    expect(parseSectorSnapshot({ sectorStages: stages })).toEqual({ kind: 'stages', stages });
    expect(parseSectorSnapshot({ number: 3 })).toBeNull();
    expect(parseSectorSnapshot({ sectorSteps: { steps: [] } })).toBeNull();
  });
});
