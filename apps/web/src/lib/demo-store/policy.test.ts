import { describe, expect, it } from 'vitest';
import {
  computeProvisionalDistribution,
  ProvisionalFormulaError,
  type ProvisionalRow,
} from '@/lib/distribution/provisional-formula';
import { PARAMS, STANDARD_VALUES } from './config';
import {
  addStaff,
  closeWeek,
  emptyVenue,
  normalizeVenue,
  positionsOf,
  seedVenue,
  setDailyTip,
  setHours,
  startWeek,
  weekPolicy,
  type Outcome,
  type Venue,
} from './model';
import { effectivePermissions } from './permissions';
import {
  appendVersion,
  currentVersion,
  paramOrigin,
  policyGaps,
  standardPolicy,
  versionOf,
} from './policy';
import { addPosition, repinWeek, setConfigValue, setPositionFactor } from './policy-ops';
import { voidWeek } from './revisions';
import { applyToActiveVenue, createVenue, seedWorkspace, setActiveVenue } from './workspace';

const AT = '2026-09-26T12:00:00.000Z';
const BY = 'Encargado';

function ok(outcome: Outcome): Venue {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.venue;
}

function err(outcome: Outcome): string {
  if (outcome.ok) throw new Error('Se esperaba un error');
  return outcome.error;
}

const weekOf = (venue: Venue, id: string) => {
  const week = venue.weeks.find((w) => w.id === id);
  if (!week) throw new Error('semana no encontrada');
  return week;
};

/** Local con dos personas de salón y una semana abierta con pozo y horas. */
function venueWithOpenWeek(): Venue {
  let v = emptyVenue('x', 'Local', standardPolicy(AT));
  v = ok(addStaff(v, { id: 'a', name: 'Ana', positionId: 'salon' }));
  v = ok(addStaff(v, { id: 'b', name: 'Beto', positionId: 'salon' }));
  v = ok(startWeek(v, '2026-09-21', 'w1', AT));
  v = ok(setDailyTip(v, 'w1', '2026-09-21', '100.000'));
  v = ok(setHours(v, 'w1', 'a', '1'));
  return ok(setHours(v, 'w1', 'b', '2'));
}

describe('configuración estándar', () => {
  it('es válida, completa y trae puestos con porción', () => {
    const version = currentVersion(standardPolicy(AT));
    expect(version).toMatchObject({ number: 1, origin: 'ESTANDAR' });
    expect(version.positions.map((p) => [p.name, p.factor])).toEqual([
      ['Supervisor', '0,014'],
      ['Barra', '0,022'],
      ['Salón', '0,022'],
      ['Bacha', '0,007'],
    ]);
    expect(policyGaps(version)).toEqual([]);
    expect(PARAMS.every((p) => paramOrigin(version, p.key) === 'ESTANDAR')).toBe(true);
  });

  it('un local nuevo con la estándar puede calcular y cerrar enseguida', () => {
    const closed = ok(closeWeek(venueWithOpenWeek(), 'w1', AT));
    const result = weekOf(closed, 'w1').result;
    expect(result?.policyVersion).toBe(1);
    expect(result?.config).toEqual(STANDARD_VALUES);
  });
});

describe('versiones de la política', () => {
  it('cambiar un parámetro crea una versión nueva y vigente; la anterior no cambia', () => {
    const v = ok(setConfigValue(seedVenue(AT), 'rounding', 'PESO', BY, AT));
    expect(v.policy.current).toBe(2);
    expect(versionOf(v.policy, 1)?.values.rounding).toBe('CENTAVO');
    expect(currentVersion(v.policy)).toMatchObject({
      number: 2,
      origin: 'CAMBIO',
      createdBy: BY,
      summary: 'Redondeo: Centavos → Pesos enteros',
    });
    expect(paramOrigin(currentVersion(v.policy), 'rounding')).toBe('PERSONALIZADO');
  });

  it('rechaza opciones no implementadas y cambios que no cambian nada', () => {
    const venue = seedVenue(AT);
    expect(err(setConfigValue(venue, 'splitTiming', 'POR_DIA', BY, AT))).toMatch(/todavía no/);
    expect(err(setConfigValue(venue, 'rounding', 'INVENTADO', BY, AT))).toMatch(/no existe/);
    expect(err(setConfigValue(venue, 'rounding', 'CENTAVO', BY, AT))).toMatch(/ya es/);
  });

  it('puestos y porciones son parte de la política: agregar o cambiar crea versión', () => {
    let v = ok(
      addPosition(seedVenue(AT), { id: 'cocina', name: 'Cocina', factor: '0.015' }, BY, AT),
    );
    expect(currentVersion(v.policy).summary).toBe('Nuevo puesto: Cocina (porción 0,015)');
    v = ok(setPositionFactor(v, 'salon', '0,025', BY, AT));
    expect(v.policy.current).toBe(3);
    expect(currentVersion(v.policy).summary).toBe('Salón: porción 0,022 → 0,025');
    expect(positionsOf(v).find((p) => p.id === 'salon')?.factor).toBe('0,025');
    expect(versionOf(v.policy, 1)?.positions.find((p) => p.id === 'salon')?.factor).toBe('0,022');
  });

  it('el personal NO es parte de la política: agregar gente no crea versión', () => {
    const v = ok(addStaff(seedVenue(AT), { id: 'n', name: 'Nueva', positionId: 'barra' }));
    expect(v.policy.versions).toHaveLength(1);
  });

  it('cada local tiene su propia política', () => {
    const created = createVenue(seedWorkspace(AT), { id: 'm', name: 'Mercado', by: BY, at: AT });
    if (!created.ok) throw new Error(created.error);
    const back = setActiveVenue(created.workspace, 'local-demo');
    if (!back.ok) throw new Error(back.error);
    const changed = applyToActiveVenue(back.workspace, (v) =>
      setConfigValue(v, 'rounding', 'PESO', BY, AT),
    );
    if (!changed.ok) throw new Error(changed.error);
    const policyOf = (id: string) => changed.workspace.venues.find((v) => v.id === id)?.policy;
    expect(policyOf('local-demo')?.current).toBe(2);
    expect(policyOf('m')?.current).toBe(1);
  });
});

describe('períodos y versiones', () => {
  it('la semana queda fijada a la versión vigente al empezar', () => {
    expect(weekOf(venueWithOpenWeek(), 'w1').policyVersion).toBe(1);
  });

  it('cambiar la política con la semana abierta la pasa a la versión nueva (queda registrado)', () => {
    const v = ok(setConfigValue(venueWithOpenWeek(), 'rounding', 'PESO', BY, AT));
    const week = weekOf(v, 'w1');
    expect(week.policyVersion).toBe(2);
    expect(week.policyLog).toEqual([{ at: AT, by: BY, from: 1, to: 2, automatic: true }]);
    const closed = ok(closeWeek(v, 'w1', AT));
    expect(weekOf(closed, 'w1').result?.rows.map((r) => r.amountCents)).toEqual([
      '3333300',
      '6666700',
    ]);
  });

  it('una semana cerrada no cambia aunque cambie la política', () => {
    let v = ok(closeWeek(venueWithOpenWeek(), 'w1', AT));
    v = ok(setConfigValue(v, 'rounding', 'PESO', BY, AT));
    v = ok(setPositionFactor(v, 'salon', '0,03', BY, AT));
    const result = weekOf(v, 'w1').result;
    expect(result?.policyVersion).toBe(1);
    expect(result?.config?.rounding).toBe('CENTAVO');
    expect(result?.rows.every((r) => r.factorE4 === '220')).toBe(true);
  });

  it('una semana reabierta conserva su versión; cambiarla es explícito y con motivo', () => {
    let v = ok(closeWeek(venueWithOpenWeek(), 'w1', AT));
    v = ok(voidWeek(v, 'w1', BY, AT, 'Faltaron horas de alguien'));
    v = ok(setConfigValue(v, 'rounding', 'PESO', BY, AT));
    expect(weekOf(v, 'w1').policyVersion).toBe(1);
    expect(weekPolicy(v, weekOf(v, 'w1')).values.rounding).toBe('CENTAVO');

    expect(err(repinWeek(v, 'w1', 2, BY, AT, 'corto'))).toMatch(/motivo/);
    expect(err(repinWeek(v, 'w1', 9, BY, AT, 'Motivo suficientemente largo'))).toMatch(/no existe/);
    v = ok(repinWeek(v, 'w1', 2, BY, AT, 'Corregimos con el redondeo nuevo'));
    expect(weekOf(v, 'w1').policyLog?.at(-1)).toEqual({
      at: AT,
      by: BY,
      from: 1,
      to: 2,
      automatic: false,
      reason: 'Corregimos con el redondeo nuevo',
    });
    expect(weekOf(ok(closeWeek(v, 'w1', AT)), 'w1').result?.policyVersion).toBe(2);
  });
});

describe('personalización incompleta', () => {
  it('con algo por definir se puede guardar y ver la vista previa, pero no cerrar', () => {
    const base = venueWithOpenWeek();
    // Una versión personalizada sin puestos (p. ej. armada desde cero y todavía incompleta).
    const { policy } = appendVersion(base.policy, {
      createdAt: AT,
      createdBy: BY,
      origin: 'CAMBIO',
      summary: 'Sin puestos',
      values: { ...STANDARD_VALUES },
      positions: [],
    });
    const incomplete: Venue = {
      ...base,
      policy,
      weeks: base.weeks.map((w) => ({ ...w, policyVersion: 2 })),
    };
    expect(policyGaps(currentVersion(policy))).toEqual([
      'Puestos: definí al menos un puesto con su porción.',
    ]);
    expect(err(closeWeek(incomplete, 'w1', AT))).toMatch(/por definir/);
  });
});

describe('datos guardados antes de las versiones', () => {
  it('puestos y configuración sueltos se convierten en la versión 1 sin cambiar valores', () => {
    const { policy, ...rest } = seedVenue(AT);
    void policy;
    const legacy = {
      ...rest,
      positions: [{ id: 'p', name: 'Mozo', factor: '0,02' }],
      config: { values: { rounding: 'PESO' }, status: { rounding: 'PENDIENTE' } },
    };
    const venue = normalizeVenue(legacy);
    expect(venue?.policy.current).toBe(1);
    expect(venue && currentVersion(venue.policy).values.rounding).toBe('PESO');
    expect(venue && positionsOf(venue)).toEqual([{ id: 'p', name: 'Mozo', factor: '0,02' }]);
  });

  it('las semanas guardadas sin versión quedan fijadas a la versión 1 (no a la vigente)', () => {
    const base = venueWithOpenWeek();
    const legacyWeeks = base.weeks.map(({ policyVersion, ...week }) => {
      void policyVersion;
      return week;
    });
    const loaded = normalizeVenue({ ...base, weeks: legacyWeeks });
    if (!loaded) throw new Error('no cargó');
    const changed = ok(setConfigValue(loaded, 'rounding', 'PESO', BY, AT));
    // La semana abierta (no reabierta) pasa a la versión 2 desde la 1, con registro.
    expect(weekOf(changed, 'w1').policyLog?.[0]).toMatchObject({ from: 1, to: 2 });
    expect(weekOf(loaded, 'w1').policyVersion).toBe(1);
  });
});

describe('redondeo', () => {
  it('en pesos enteros, un pozo con centavos no se puede repartir', () => {
    expect(() =>
      computeProvisionalDistribution(
        10_050n,
        [{ id: 'a', hoursE2: 100n, factorE4: 1n, advanceCents: 0n }],
        { unitCents: 100n },
      ),
    ).toThrow(ProvisionalFormulaError);
  });

  it('en centavos: $100.000 entre 1 y 2 horas → 33.333,33 / 66.666,67', () => {
    const closed = ok(closeWeek(venueWithOpenWeek(), 'w1', AT));
    expect(weekOf(closed, 'w1').result?.rows.map((r) => r.amountCents)).toEqual([
      '3333333',
      '6666667',
    ]);
  });
});

/*
 * Caso de referencia Library (foto de la planilla, 23/11/2024; nombres anonimizados).
 * Pesos deducidos de la foto, NO confirmados: Supervisor 0,65; Barra y Salón 1; en Bacha 0,30 y
 * 0,315 (los importes solo cierran así). El "÷ 45" de la planilla no cambia el reparto.
 * Demuestra que GUTIP puede reproducir esa configuración; no la convierte en regla.
 */
describe('referencia Library', () => {
  const row = (id: string, hours: bigint, weightE4: bigint): ProvisionalRow => ({
    id,
    hoursE2: hours * 100n,
    factorE4: weightE4,
    advanceCents: 0n,
  });
  const rows = [
    row('e01', 45n, 6500n),
    row('e02', 18n, 6500n),
    row('e03', 45n, 10000n),
    row('e04', 13n, 10000n),
    row('e05', 54n, 10000n),
    row('e06', 36n, 10000n),
    row('e07', 32n, 10000n),
    row('e08', 5n, 10000n),
    row('e09', 5n, 10000n),
    row('e10', 24n, 3000n),
    row('e11', 20n, 3150n),
    row('e12', 4n, 3000n),
  ];

  it('con redondeo a pesos enteros reproduce los 12 importes de la planilla', () => {
    const result = computeProvisionalDistribution(34_799_000n, rows, { unitCents: 100n });
    expect(result.items.map((i) => i.amountCents / 100n)).toEqual([
      41436n,
      16574n,
      63747n,
      18416n,
      76497n,
      50998n,
      45331n,
      7083n,
      7083n,
      10200n,
      8925n,
      1700n,
    ]);
  });
});

describe('permisos según la política', () => {
  const editor = {
    id: 'm',
    name: 'Ed',
    email: '',
    role: 'EDITOR' as const,
    staffId: null,
    status: 'INVITADO' as const,
    invitedAt: AT,
  };

  it('el Editor maneja sobres solo si la política lo dice; revertir sigue siendo del Encargado', () => {
    expect(effectivePermissions(editor, STANDARD_VALUES).handleEnvelopes).toBe(false);
    const both = effectivePermissions(editor, {
      ...STANDARD_VALUES,
      envelopes: 'ENCARGADO_Y_EDITOR',
    });
    expect(both).toMatchObject({ handleEnvelopes: true, revertDelivery: false });
    expect(effectivePermissions(null).configureDistribution).toBe(true);
  });
});
