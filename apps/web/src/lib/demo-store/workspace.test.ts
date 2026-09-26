import { describe, expect, it } from 'vitest';
import { addStaff, positionsOf, seedVenue } from './model';
import { addPosition } from './policy-ops';
import {
  activeVenue,
  applyToActiveVenue,
  createVenue,
  parseStoredWorkspace,
  renameVenue,
  seedWorkspace,
  setActiveVenue,
  type Workspace,
  type WorkspaceOutcome,
} from './workspace';

const CLOSED_AT = '2026-09-26T12:00:00.000Z';

function ok(outcome: WorkspaceOutcome): Workspace {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.workspace;
}

function err(outcome: WorkspaceOutcome): string {
  if (outcome.ok) throw new Error('Se esperaba un error');
  return outcome.error;
}

/** Faena Library (copia de la política del local demo) y Faena Mercado (configuración estándar). */
function twoVenues(): Workspace {
  let ws = seedWorkspace(CLOSED_AT);
  ws = ok(
    createVenue(ws, {
      id: 'library',
      name: 'Faena Library',
      copyPolicyFrom: 'local-demo',
      by: 'Encargado',
      at: '2026-09-26T12:00:00.000Z',
    }),
  );
  ws = ok(
    createVenue(ws, {
      id: 'mercado',
      name: 'Faena Mercado',
      by: 'Encargado',
      at: '2026-09-26T12:00:00.000Z',
    }),
  );
  return ws;
}

describe('locales', () => {
  it('crea locales vacíos y deja activo el último creado', () => {
    const ws = twoVenues();
    expect(ws.venues.map((v) => v.name)).toEqual([
      'Restaurante demo',
      'Faena Library',
      'Faena Mercado',
    ]);
    expect(activeVenue(ws).id).toBe('mercado');
    const library = ws.venues.find((v) => v.id === 'library');
    expect(library?.staff).toEqual([]);
    expect(library?.weeks).toEqual([]);
    expect((library ? positionsOf(library) : []).map((p) => p.name)).toEqual([
      'Supervisor',
      'Barra',
      'Salón',
      'Bacha',
    ]);
    // Un local nuevo arranca con la configuración estándar, que ya trae puestos y pesos.
    const mercado = ws.venues.find((v) => v.id === 'mercado');
    expect(mercado?.policy.versions[0]?.origin).toBe('ESTANDAR');
    expect((mercado ? positionsOf(mercado) : []).map((p) => p.name)).toEqual([
      'Supervisor',
      'Barra',
      'Salón',
      'Bacha',
    ]);
    expect(library?.policy.versions[0]?.origin).toBe('COPIA');
  });

  it('el personal de un local no aparece en otro', () => {
    let ws = twoVenues();
    ws = ok(setActiveVenue(ws, 'library'));
    ws = ok(
      applyToActiveVenue(ws, (v) => addStaff(v, { id: 'p1', name: 'Ana', positionId: 'salon' })),
    );
    expect(ws.venues.find((v) => v.id === 'library')?.staff.map((s) => s.name)).toEqual(['Ana']);
    expect(ws.venues.find((v) => v.id === 'mercado')?.staff).toEqual([]);
    expect(ws.venues.find((v) => v.id === 'local-demo')?.staff).toHaveLength(12);
  });

  it('los puestos copiados son independientes del local de origen', () => {
    let ws = twoVenues();
    ws = ok(setActiveVenue(ws, 'library'));
    ws = ok(
      applyToActiveVenue(ws, (v) =>
        addPosition(v, { id: 'cocina', name: 'Cocina', factor: '0,015' }, 'Encargado', CLOSED_AT),
      ),
    );
    const positionsIn = (id: string) => {
      const venue = ws.venues.find((v) => v.id === id);
      return venue ? positionsOf(venue) : [];
    };
    expect(positionsIn('library')).toHaveLength(5);
    expect(positionsIn('local-demo')).toHaveLength(4);
  });

  it('valida nombres de local', () => {
    const ws = twoVenues();
    expect(
      err(
        createVenue(ws, { id: 'x', name: '  ', by: 'Encargado', at: '2026-09-26T12:00:00.000Z' }),
      ),
    ).toMatch(/nombre/);
    expect(
      err(
        createVenue(ws, {
          id: 'x',
          name: 'faena library',
          by: 'Encargado',
          at: '2026-09-26T12:00:00.000Z',
        }),
      ),
    ).toMatch(/Ya existe/);
    expect(err(renameVenue(ws, 'mercado', 'Faena Library'))).toMatch(/Ya existe/);
    expect(err(setActiveVenue(ws, 'nada'))).toMatch(/no existe/);
    const renamed = ok(renameVenue(ws, 'mercado', 'Faena Mercado Centro'));
    expect(renamed.venues.find((v) => v.id === 'mercado')?.name).toBe('Faena Mercado Centro');
  });
});

describe('datos guardados', () => {
  it('lee el formato actual', () => {
    const ws = twoVenues();
    expect(parseStoredWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  it('convierte el formato anterior (un solo restaurante) en un local', () => {
    const venue = seedVenue(CLOSED_AT);
    const legacy = {
      version: 1,
      restaurantName: 'Mi restaurante',
      positions: positionsOf(venue),
      staff: venue.staff,
      weeks: venue.weeks,
    };
    const ws = parseStoredWorkspace(legacy);
    expect(ws?.venues).toHaveLength(1);
    expect(ws?.venues[0]).toMatchObject({ name: 'Mi restaurante', weeks: venue.weeks });
  });

  it('descarta datos que no sirven', () => {
    expect(parseStoredWorkspace(null)).toBeNull();
    expect(parseStoredWorkspace({ version: 2, venues: [] })).toBeNull();
    expect(parseStoredWorkspace({ version: 9 })).toBeNull();
  });
});
