import { describe, expect, it } from 'vitest';
import { STANDARD_VALUES } from '@/lib/demo-store/config';
import { standardPolicy } from '@/lib/demo-store/policy';
import {
  planAddPosition,
  planConfigValue,
  planPortionChange,
  planSectorsChange,
  STAGED_GROUPS,
  type PolicyDraft,
} from './changes';
import {
  columnsToValues,
  participationMethodOf,
  portionFromDb,
  portionToDb,
  stagePercentFromDb,
  stagePercentToDb,
  valuesToColumns,
} from './db-mapping';
import { STANDARD_TEMPLATE } from './standard';

const standard = (): PolicyDraft => {
  const v1 = standardPolicy('2026-09-26T00:00:00.000Z').versions[0];
  if (!v1) throw new Error('sin versión estándar');
  return { values: v1.values, positions: v1.positions };
};

describe('plantilla estándar', () => {
  it('es la misma configuración estándar que la demo, con código y versión de plantilla', () => {
    expect(STANDARD_TEMPLATE.code).toBe('gutip-standard');
    expect(STANDARD_TEMPLATE.version).toBe(1);
    expect(STANDARD_TEMPLATE.values).toEqual(STANDARD_VALUES);
    expect(STANDARD_TEMPLATE.positions).toEqual(
      standard().positions.map(({ name, factor }) => ({ name, factor })),
    );
    expect(STANDARD_TEMPLATE.periodStartWeekday).toBe(1);
  });
});

describe('cambios de política (reglas compartidas por demo y base)', () => {
  it('cambiar un parámetro produce el borrador y el resumen', () => {
    const plan = planConfigValue(standard(), 'rounding', 'PESO');
    expect(plan).toMatchObject({ ok: true, summary: 'Redondeo: Centavos → Pesos enteros' });
    if (plan.ok) expect(plan.draft.values.rounding).toBe('PESO');
  });

  it('rechaza opciones inexistentes, no implementadas o ya vigentes', () => {
    expect(planConfigValue(standard(), 'rounding', 'INVENTADO')).toEqual({
      ok: false,
      error: 'Esa opción no existe.',
    });
    expect(planConfigValue(standard(), 'splitTiming', 'POR_DIA')).toMatchObject({ ok: false });
    expect(planConfigValue(standard(), 'rounding', 'CENTAVO')).toEqual({
      ok: false,
      error: 'Ese ya es el valor vigente.',
    });
  });

  it('cambiar la porción conserva la identidad del puesto', () => {
    const plan = planPortionChange(standard(), 'salon', '0.025');
    expect(plan).toMatchObject({ ok: true, summary: 'Salón: porción 0,022 → 0,025' });
    if (plan.ok) {
      expect(plan.draft.positions.find((p) => p.id === 'salon')).toEqual({
        id: 'salon',
        name: 'Salón',
        factor: '0,025',
      });
    }
    expect(planPortionChange(standard(), 'salon', '0,022')).toMatchObject({ ok: false });
    expect(planPortionChange(standard(), 'no-existe', '0,02')).toMatchObject({ ok: false });
    expect(planPortionChange(standard(), 'salon', '0')).toMatchObject({ ok: false });
  });

  it('agregar un puesto valida nombre (sin distinguir mayúsculas) y porción', () => {
    expect(
      planAddPosition(standard(), { id: 'cocina', name: ' Cocina ', factor: '0,015' }),
    ).toMatchObject({ ok: true, summary: 'Nuevo puesto: Cocina (porción 0,015)' });
    expect(planAddPosition(standard(), { id: 'x', name: 'barra', factor: '0,02' })).toEqual({
      ok: false,
      error: 'Ya existe el puesto "barra".',
    });
    expect(planAddPosition(standard(), { id: 'x', name: '', factor: '0,02' })).toMatchObject({
      ok: false,
    });
    expect(planAddPosition(standard(), { id: 'x', name: 'Runner', factor: 'abc' })).toMatchObject({
      ok: false,
    });
  });
});

describe('traducción a la base', () => {
  it('los valores estándar van y vuelven sin cambios', () => {
    const columns = valuesToColumns(STANDARD_VALUES, 1);
    expect(columns).toEqual({
      periodKind: 'WEEKLY',
      periodStartWeekday: 1,
      splitTiming: 'PER_PERIOD',
      hoursBasis: 'PERIOD_TOTAL',
      hoursEntry: 'PERIOD_TOTAL_AT_CLOSE',
      potSources: 'SINGLE_DAILY_AMOUNT',
      poolStructure: 'SINGLE_POOL',
      portionMode: 'BY_POSITION',
      roundingUnit: 'CENT',
      advanceDeduction: 'WHOLE_PERIOD',
      envelopeHandlers: 'MANAGER_ONLY',
    });
    expect(columnsToValues(columns)).toEqual(STANDARD_VALUES);
  });

  it('las opciones configurables hoy tienen su valor en la base', () => {
    const values = {
      ...STANDARD_VALUES,
      rounding: 'PESO',
      envelopes: 'ENCARGADO_Y_EDITOR',
    } as const;
    const columns = valuesToColumns(values, 4);
    expect(columns).toMatchObject({
      roundingUnit: 'PESO',
      envelopeHandlers: 'MANAGER_AND_EDITOR',
      periodStartWeekday: 4,
    });
    expect(columnsToValues(columns)).toEqual(values);
  });

  it('los tres métodos de participación van y vuelven con su valor en la base', () => {
    for (const [weights, portionMode] of [
      ['POR_PUESTO', 'BY_POSITION'],
      ['POR_PUNTOS', 'BY_POINTS'],
      ['PUESTO_POR_PUNTOS', 'BY_POSITION_TIMES_POINTS'],
    ] as const) {
      const values = { ...STANDARD_VALUES, weights };
      const columns = valuesToColumns(values, 1);
      expect(columns.portionMode).toBe(portionMode);
      expect(participationMethodOf(columns.portionMode)).toBe(portionMode);
      expect(columnsToValues(columns)).toEqual(values);
    }
    expect(() =>
      valuesToColumns({ ...STANDARD_VALUES, weights: 'PUESTO_CON_EXCEPCIONES' }, 1),
    ).toThrow(/todavía no se puede guardar/);
  });

  it('cambiar el método de participación crea una versión con su resumen', () => {
    const plan = planConfigValue(
      { values: STANDARD_VALUES, positions: [] },
      'weights',
      'PUESTO_POR_PUNTOS',
    );
    expect(plan).toMatchObject({
      ok: true,
      summary: 'Método de participación: Por puesto → Puesto × puntos',
    });
  });

  it('una opción "próximamente" no se puede guardar', () => {
    expect(() => valuesToColumns({ ...STANDARD_VALUES, rounding: 'DIEZ' }, 1)).toThrow(
      /todavía no se puede guardar/,
    );
  });

  it('la porción se guarda con 10 decimales exactos y se muestra sin ceros de más', () => {
    expect(portionToDb('0,022')).toBe('0.0220000000');
    expect(portionToDb('0.0144444444')).toBe('0.0144444444');
    expect(portionFromDb('0.0220000000')).toBe('0,022');
    expect(portionFromDb('0.0144444444')).toBe('0,0144444444');
    expect(portionFromDb(portionToDb('0,007'))).toBe('0,007');
    expect(() => portionToDb('0')).toThrow();
    expect(() => portionToDb('0,00000000001')).toThrow();
  });
});

describe('reparto por sectores', () => {
  const ids = (draft: PolicyDraft, ...names: string[]) =>
    draft.positions.filter((p) => names.includes(p.name)).map((p) => p.id);
  /** Cocina 30 % del total (sin puestos), Salón 50 % del saldo y Bacha el resto. */
  const pedido = (draft: PolicyDraft) =>
    planSectorsChange(draft, [
      { name: 'Cocina', base: 'TOTAL', percent: '30', positionIds: [] },
      {
        name: 'Salón',
        base: 'REMAINDER',
        percent: '50,00',
        positionIds: ids(draft, 'Salón', 'Supervisor', 'Barra'),
      },
      { name: 'Bacha', base: 'REMAINDER', percent: '100', positionIds: ids(draft, 'Bacha') },
    ]);

  it('no se activa desde el selector sin sectores', () => {
    expect(planConfigValue(standard(), 'groups', STAGED_GROUPS)).toEqual({
      ok: false,
      error:
        'Para repartir por sectores, primero armá los sectores en "Reparto por sectores" y guardalos.',
    });
  });

  it('guarda todos los sectores juntos, con sus puestos, y activa el reparto por sectores', () => {
    const plan = pedido(standard());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.draft.values.groups).toBe(STAGED_GROUPS);
    expect(plan.draft.sectors).toEqual([
      { id: 'sector-1', name: 'Cocina', base: 'TOTAL', percent: '30' },
      { id: 'sector-2', name: 'Salón', base: 'REMAINDER', percent: '50' },
      { id: 'sector-3', name: 'Bacha', base: 'REMAINDER', percent: '100' },
    ]);
    expect(Object.fromEntries(plan.draft.positions.map((p) => [p.name, p.sectorId]))).toEqual({
      Supervisor: 'sector-2',
      Barra: 'sector-2',
      Salón: 'sector-2',
      Bacha: 'sector-3',
    });
    expect(plan.summary).toBe(
      'Grupos y porcentajes: Sin grupos → Por sectores. Reparto por sectores: Cocina 30 % del total · Salón 50 % del saldo (Supervisor, Barra, Salón) · Bacha 100 % del saldo (Bacha)',
    );
    // Guardar lo mismo otra vez no crea una versión.
    expect(pedido(plan.draft)).toEqual({ ok: false, error: 'Esa ya es la configuración vigente.' });
    // Otros cambios conservan los sectores.
    const portion = planPortionChange(plan.draft, ids(plan.draft, 'Barra')[0] ?? '', '0,03');
    expect(portion.ok && portion.draft.sectors).toEqual(plan.draft.sectors);
    // Ya completos, también se pueden volver a elegir desde el selector.
    const back = planConfigValue(plan.draft, 'groups', 'SIN_GRUPOS');
    expect(back.ok).toBe(true);
    if (back.ok) expect(planConfigValue(back.draft, 'groups', STAGED_GROUPS).ok).toBe(true);
  });

  it('rechaza configuraciones incompletas o que piden más de lo que queda', () => {
    const draft = standard();
    expect(
      planSectorsChange(draft, [{ name: 'Cocina', base: 'TOTAL', percent: 'x', positionIds: [] }]),
    ).toEqual({
      ok: false,
      error:
        'Cocina: el porcentaje tiene que ser un número mayor que 0 y hasta 100 (hasta 2 decimales).',
    });
    expect(
      planSectorsChange(draft, [
        { name: 'Cocina', base: 'TOTAL', percent: '70', positionIds: [] },
        { name: 'Bacha', base: 'TOTAL', percent: '40', positionIds: [] },
      ]),
    ).toEqual({
      ok: false,
      error:
        'Bacha pide el 40 % del total, pero en ese paso solo queda el 30 % del total. Bajá su porcentaje o calculalo sobre el saldo.',
    });
    expect(
      planSectorsChange(draft, [
        { name: 'Cocina', base: 'TOTAL', percent: '30', positionIds: ['otro-restaurante'] },
      ]),
    ).toEqual({ ok: false, error: 'Uno de los puestos ya no existe: recargá la página.' });
  });

  it('el porcentaje de etapa se guarda en la base con 2 decimales', () => {
    expect(stagePercentToDb('12,5')).toBe('12.50');
    expect(stagePercentFromDb('12.50')).toBe('12,5');
    expect(stagePercentFromDb('100.00')).toBe('100');
    expect(() => stagePercentToDb('0')).toThrow();
    expect(valuesToColumns({ ...STANDARD_VALUES, groups: STAGED_GROUPS }, 1).poolStructure).toBe(
      'STAGED_SECTORS',
    );
  });
});
