import { describe, expect, it } from 'vitest';
import { STANDARD_VALUES } from '@/lib/demo-store/config';
import { standardPolicy } from '@/lib/demo-store/policy';
import { planAddPosition, planConfigValue, planPortionChange, type PolicyDraft } from './changes';
import { columnsToValues, portionFromDb, portionToDb, valuesToColumns } from './db-mapping';
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
