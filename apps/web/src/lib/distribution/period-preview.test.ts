import { describe, expect, it } from 'vitest';
import { buildPeriodPreview, parseHours, type PreviewPerson } from './period-preview';

const FACTOR = { Supervisor: '0,014', Barra: '0,022', Salón: '0,022', Bacha: '0,007' } as const;
type Puesto = keyof typeof FACTOR;

function person(
  name: string,
  puesto: Puesto,
  hours: string | null,
  extra: Partial<PreviewPerson> = {},
): PreviewPerson {
  return {
    employeeId: name,
    name,
    positionId: puesto,
    positionName: puesto,
    factor: FACTOR[puesto],
    hours,
    advanceCents: 0n,
    active: true,
    ...extra,
  };
}

/** Semana de la planilla de Library (Hotel Faena): $ 347.990 y 12 personas. */
const LIBRARY: PreviewPerson[] = [
  person('Ivan', 'Supervisor', '45'),
  person('Nardelli', 'Supervisor', '18'),
  person('Roro', 'Barra', '45'),
  person('Marcos', 'Barra', '13'),
  person('Leo', 'Salón', '54'),
  person('Isaías', 'Salón', '36'),
  person('Agus Fulleda', 'Salón', '32'),
  person('Cami noche', 'Salón', '5'),
  person('Agus noche', 'Salón', '5'),
  person('Nahuel', 'Bacha', '24'),
  person('Jesús', 'Bacha', '20'),
  person('Jean', 'Bacha', '4'),
];
const TOTAL = 34_799_000n;

const amounts = (preview: ReturnType<typeof buildPeriodPreview>) =>
  Object.fromEntries(preview.rows.map((r) => [r.name, r.amountCents]));

describe('reparto del período: caso Library', () => {
  const preview = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people: LIBRARY });

  it('calcula con la fórmula de GUTIP (5,398 puntos, punto a $ 64.466,47)', () => {
    expect(preview.canClose).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(preview.totalPointsE6).toBe(5_398_000n);
    expect(preview.pointValueCents).toBe(6_446_647n);
    expect(preview.totalHoursE2).toBe(30_100n);
    expect(amounts(preview)).toMatchObject({
      Ivan: 4_061_388n,
      Nardelli: 1_624_555n,
      Roro: 6_382_180n,
      Marcos: 1_843_741n,
      Leo: 7_658_617n,
      Isaías: 5_105_744n,
      'Agus Fulleda': 4_538_439n,
      'Cami noche': 709_131n,
      'Agus noche': 709_131n,
      Nahuel: 1_083_037n,
      Jesús: 902_531n,
      Jean: 180_506n,
    });
  });

  it('la suma da exacto el total', () => {
    expect(preview.rows.reduce((sum, r) => sum + r.amountCents, 0n)).toBe(TOTAL);
    expect(preview.totalFinalCents).toBe(TOTAL);
  });

  it('explica el valor de la hora de cada puesto', () => {
    expect(preview.hourValues).toEqual([
      { positionName: 'Supervisor', factor: '0,014', centsPerHour: 90_253n },
      { positionName: 'Barra', factor: '0,022', centsPerHour: 141_826n },
      { positionName: 'Salón', factor: '0,022', centsPerHour: 141_826n },
      { positionName: 'Bacha', factor: '0,007', centsPerHour: 45_127n },
    ]);
  });

  it('en pesos enteros la suma también da exacto', () => {
    const pesos = buildPeriodPreview({ totalCents: TOTAL, unitCents: 100n, people: LIBRARY });
    expect(pesos.canClose).toBe(true);
    expect(pesos.rows.every((r) => r.amountCents % 100n === 0n)).toBe(true);
    expect(pesos.rows.reduce((sum, r) => sum + r.amountCents, 0n)).toBe(TOTAL);
  });
});

describe('reparto del período: casos especiales', () => {
  it('una sola persona se lleva todo', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      people: [person('Ana', 'Salón', '8')],
    });
    expect(preview.canClose).toBe(true);
    expect(preview.rows[0]?.amountCents).toBe(10_000n);
  });

  it('0 horas: no recibe nada, no bloquea y no reparte su parte como si hubiera trabajado', () => {
    const people = LIBRARY.map((p) => (p.name === 'Jean' ? { ...p, hours: '0' } : p));
    const preview = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people });
    const jean = preview.rows.find((r) => r.name === 'Jean');
    expect(jean).toMatchObject({ state: 'zero', amountCents: 0n });
    expect(preview.canClose).toBe(true);
    expect(preview.rows.reduce((sum, r) => sum + r.amountCents, 0n)).toBe(TOTAL);
  });

  it('sin horas cargadas: queda marcada y bloquea el cierre (aunque haya vista previa)', () => {
    const people = LIBRARY.map((p) => (p.name === 'Jean' ? { ...p, hours: null } : p));
    const preview = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people });
    expect(preview.rows.find((r) => r.name === 'Jean')?.state).toBe('missing');
    expect(preview.computed).toBe(true);
    expect(preview.canClose).toBe(false);
    expect(preview.issues).toEqual([
      {
        code: 'MISSING_HOURS',
        message: 'Falta cargar las horas de Jean. Si no trabajó, poné 0.',
        employeeIds: ['Jean'],
      },
    ]);
  });

  it('todos con 0 horas: no hay reparto posible', () => {
    const preview = buildPeriodPreview({
      totalCents: TOTAL,
      unitCents: 1n,
      people: [person('Ana', 'Salón', '0'), person('Beto', 'Barra', '0')],
    });
    expect(preview.computed).toBe(false);
    expect(preview.canClose).toBe(false);
    expect(preview.issues.map((i) => i.code)).toEqual(['NO_HOURS']);
  });

  it('propina $ 0: pide cargar la propina', () => {
    const preview = buildPeriodPreview({ totalCents: 0n, unitCents: 1n, people: LIBRARY });
    expect(preview.computed).toBe(false);
    expect(preview.canClose).toBe(false);
    expect(preview.issues.map((i) => i.code)).toEqual(['NO_TIPS']);
  });

  it('sin personal: lo dice', () => {
    const preview = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people: [] });
    expect(preview.issues.map((i) => i.code)).toEqual(['NO_PEOPLE']);
    expect(preview.canClose).toBe(false);
  });

  it('horas inválidas o de más: se marcan y bloquean', () => {
    const preview = buildPeriodPreview({
      totalCents: TOTAL,
      unitCents: 1n,
      people: [person('Ana', 'Salón', '8'), person('Beto', 'Barra', '169')],
    });
    expect(preview.rows[1]?.state).toBe('invalid');
    expect(preview.issues.map((i) => i.code)).toEqual(['INVALID_HOURS']);
    expect(preview.canClose).toBe(false);
  });

  it('una persona de baja sin horas no bloquea; con horas, participa', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      people: [
        person('Ana', 'Salón', '8'),
        person('Ex', 'Barra', null, { active: false }),
        person('Ex2', 'Barra', '8', { active: false }),
      ],
    });
    expect(preview.canClose).toBe(true);
    expect(preview.rows.map((r) => r.amountCents)).toEqual([5_000n, 0n, 5_000n]);
  });

  it('con horas pero sin puesto de la configuración: lo pide', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      people: [person('Ana', 'Salón', '8'), person('Nuevo', 'Salón', '4', { factor: null })],
    });
    expect(preview.issues.map((i) => i.code)).toEqual(['NO_POSITION']);
    expect(preview.canClose).toBe(false);
  });

  it('adelantos: se descuentan; lo que no alcanza queda pendiente', () => {
    const people = LIBRARY.map((p) =>
      p.name === 'Leo'
        ? { ...p, advanceCents: 1_000_000n }
        : p.name === 'Jean'
          ? { ...p, advanceCents: 500_000n }
          : p,
    );
    const preview = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people });
    const leo = preview.rows.find((r) => r.name === 'Leo');
    const jean = preview.rows.find((r) => r.name === 'Jean');
    expect(leo).toMatchObject({
      amountCents: 7_658_617n,
      advanceAppliedCents: 1_000_000n,
      finalCents: 6_658_617n,
      pendingAdvanceCents: 0n,
    });
    expect(jean).toMatchObject({
      amountCents: 180_506n,
      advanceAppliedCents: 180_506n,
      finalCents: 0n,
      pendingAdvanceCents: 319_494n,
    });
    expect(preview.totalAdvanceCents).toBe(1_180_506n);
    expect(preview.totalFinalCents).toBe(TOTAL - 1_180_506n);
  });

  it('un adelanto de alguien que no trabajó queda pendiente entero', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      people: [person('Ana', 'Salón', '8'), person('Beto', 'Barra', '0', { advanceCents: 700n })],
    });
    expect(preview.rows[1]).toMatchObject({ advanceAppliedCents: 0n, pendingAdvanceCents: 700n });
    expect(preview.canClose).toBe(true);
  });

  it('en pesos enteros, una propina con centavos no se puede repartir', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_050n,
      unitCents: 100n,
      people: [person('Ana', 'Salón', '8')],
    });
    expect(preview.issues.map((i) => i.code)).toEqual(['ROUNDING']);
    expect(preview.canClose).toBe(false);
  });

  it('editar y recalcular: el mismo cálculo con los datos nuevos', () => {
    const before = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people: LIBRARY });
    const edited = LIBRARY.map((p) => (p.name === 'Ivan' ? { ...p, hours: '50' } : p));
    const after = buildPeriodPreview({ totalCents: 40_000_000n, unitCents: 1n, people: edited });
    expect(after.rows[0]?.amountCents).not.toBe(before.rows[0]?.amountCents);
    expect(after.rows.reduce((sum, r) => sum + r.amountCents, 0n)).toBe(40_000_000n);
  });
});

describe('parseHours', () => {
  it('acepta coma o punto, hasta 2 decimales y hasta 168 h', () => {
    expect(parseHours('45')).toBe(4_500n);
    expect(parseHours('7,5')).toBe(750n);
    expect(parseHours('7.25')).toBe(725n);
    expect(parseHours('0')).toBe(0n);
    expect(parseHours('168')).toBe(16_800n);
    expect(parseHours('168,01')).toBeNull();
    expect(parseHours('-1')).toBeNull();
    expect(parseHours('abc')).toBeNull();
    expect(parseHours('1,234')).toBeNull();
  });
});

describe('reparto del período: métodos de participación', () => {
  const withPoints = (points: Record<string, string>) =>
    LIBRARY.map((p) => ({ ...p, individualPoints: points[p.name] ?? '1' }));

  it('BY_POSITION (explícito) ignora los puntos y da los importes de siempre', () => {
    const base = buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people: LIBRARY });
    const explicit = buildPeriodPreview({
      totalCents: TOTAL,
      unitCents: 1n,
      method: 'BY_POSITION',
      people: withPoints({ Ivan: '3', Jean: '0,5' }),
    });
    expect(amounts(explicit)).toEqual(amounts(base));
    expect(explicit.totalPointsE6).toBe(5_398_000n);
    expect(explicit.totalWeightE8).toBe(539_800_000n);
    expect(explicit.hourValues).toEqual(base.hourValues);
    expect(explicit.pointValueCents).toBe(base.pointValueCents);
  });

  it('BY_POSITION_TIMES_POINTS con todos en 1,00 = BY_POSITION', () => {
    const product = buildPeriodPreview({
      totalCents: TOTAL,
      unitCents: 1n,
      method: 'BY_POSITION_TIMES_POINTS',
      people: withPoints({}),
    });
    expect(amounts(product)).toEqual(
      amounts(buildPeriodPreview({ totalCents: TOTAL, unitCents: 1n, people: LIBRARY })),
    );
    expect(product.hourValues).toEqual([]);
  });

  it('BY_POINTS: la porción no interviene (Bacha y Supervisor pesan igual con igual horas y puntos)', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      method: 'BY_POINTS',
      people: [
        person('Ana', 'Supervisor', '8', { individualPoints: '1' }),
        person('Beto', 'Bacha', '8', { individualPoints: '1' }),
      ],
    });
    expect(preview.rows.map((r) => r.amountCents)).toEqual([5_000n, 5_000n]);
    expect(preview.rows.map((r) => r.weightE8)).toEqual([800_000_000n, 800_000_000n]);
  });

  it('puntos distintos en el mismo puesto y horas: cobra más quien tiene más puntos', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000_000n,
      unitCents: 1n,
      method: 'BY_POSITION_TIMES_POINTS',
      people: [
        person('Juan', 'Salón', '40', { individualPoints: '1,20' }),
        person('Pedro', 'Salón', '40', { individualPoints: '1,00' }),
        person('Lucas', 'Salón', '40', { individualPoints: '0,80' }),
      ],
    });
    // 1,20 : 1,00 : 0,80 de $ 100.000 → 40 % · 33,33 % · 26,67 %
    expect(preview.rows.map((r) => r.amountCents)).toEqual([4_000_000n, 3_333_333n, 2_666_667n]);
    expect(preview.rows.map((r) => r.percentE2)).toEqual([4000n, 3333n, 2667n]);
  });

  it('el método pide puntos y alguien trabajó sin puntos válidos: bloquea', () => {
    const preview = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      method: 'BY_POINTS',
      people: [
        person('Ana', 'Salón', '8', { individualPoints: '1' }),
        person('Beto', 'Salón', '8', { individualPoints: '0' }),
        person('Caro', 'Salón', '8'),
      ],
    });
    expect(preview.issues).toEqual([
      {
        code: 'NO_POINTS',
        message: 'Beto, Caro no tiene puntos válidos: cargalos en Personal.',
        employeeIds: ['Beto', 'Caro'],
      },
    ]);
    expect(preview.canClose).toBe(false);
  });

  it('con BY_POINTS no hace falta la porción, pero sí un puesto (queda en el snapshot)', () => {
    const withoutPortion = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      method: 'BY_POINTS',
      people: [person('Ana', 'Salón', '8', { factor: null, individualPoints: '1' })],
    });
    expect(withoutPortion.canClose).toBe(true);
    const withoutPosition = buildPeriodPreview({
      totalCents: 10_000n,
      unitCents: 1n,
      method: 'BY_POINTS',
      people: [
        person('Ana', 'Salón', '8', { individualPoints: '1' }),
        person('Beto', 'Salón', '8', { positionId: null, factor: null, individualPoints: '1' }),
      ],
    });
    expect(withoutPosition.issues.map((i) => i.code)).toEqual(['NO_POSITION']);
    expect(withoutPosition.canClose).toBe(false);
  });
});

describe('regresión: pozo único BY_POSITION = fórmula anterior', () => {
  it('500 repartos aleatorios dan los mismos importes, adelantos y puntos', async () => {
    const { computeProvisionalDistribution } = await import('./provisional-formula');
    let state = 314159;
    const next = (max: number) => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state % max;
    };
    const factors = ['0,014', '0,022', '0,007', '0,0145', '0,3', '1'];
    const factorE4: Record<string, bigint> = {
      '0,014': 140n,
      '0,022': 220n,
      '0,007': 70n,
      '0,0145': 145n,
      '0,3': 3000n,
      '1': 10_000n,
    };
    for (let run = 0; run < 500; run += 1) {
      const people = Array.from({ length: 1 + next(14) }, (_, i) => {
        const factor = factors[next(factors.length)]!;
        return {
          ...person(`e${i}`, 'Salón', `${next(169)}${next(2) === 0 ? ',5' : ''}`),
          factor,
          advanceCents: next(3) === 0 ? BigInt(next(3_000_000)) : 0n,
        };
      }).map((p) => (p.hours === '168,5' ? { ...p, hours: '168' } : p));
      const unitCents = next(2) === 0 ? 1n : 100n;
      const totalCents = BigInt(1 + next(40_000_000)) * unitCents;
      const preview = buildPeriodPreview({ totalCents, unitCents, people });
      const worked = preview.rows.filter((r) => r.state === 'worked');
      if (worked.length === 0) continue;
      const old = computeProvisionalDistribution(
        totalCents,
        worked.map((r) => ({
          id: r.employeeId,
          hoursE2: r.hoursE2 ?? 0n,
          factorE4: factorE4[r.factor ?? ''] ?? 0n,
          advanceCents: people.find((p) => p.employeeId === r.employeeId)?.advanceCents ?? 0n,
        })),
        { unitCents },
      );
      expect(preview.totalPointsE6).toBe(old.totalPointsE6);
      expect(
        worked.map((r) => [
          r.pointsE6,
          r.percentE2,
          r.amountCents,
          r.advanceAppliedCents,
          r.pendingAdvanceCents,
          r.finalCents,
        ]),
      ).toEqual(
        old.items.map((i) => [
          i.pointsE6,
          i.percentE2,
          i.amountCents,
          i.advanceAppliedCents,
          i.pendingAdvanceCents,
          i.finalCents,
        ]),
      );
      expect(preview.totalAdvanceCents).toBe(old.totalAdvanceCents);
      expect(preview.totalFinalCents).toBe(old.totalFinalCents);
    }
  });
});
