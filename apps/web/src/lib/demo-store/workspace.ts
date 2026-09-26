/**
 * Espacio de trabajo del encargado: varios locales (p. ej. "Faena Library" y "Faena Mercado"),
 * cada uno con su propio personal, puestos, semanas e historial. Nada se comparte entre locales.
 */
import { emptyVenue, normalizeVenue, seedVenue, type Outcome, type Venue } from './model';

export const WORKSPACE_VERSION = 2;

export interface Workspace {
  version: typeof WORKSPACE_VERSION;
  activeVenueId: string;
  venues: Venue[];
  /**
   * Simulación "Ver como…": la app se muestra con los permisos de ese miembro del local activo.
   * Solo existe en la demo, para probar los permisos antes de tener login.
   */
  viewAsMemberId?: string | null;
}

export type WorkspaceOutcome = { ok: true; workspace: Workspace } | { ok: false; error: string };

const fail = (error: string): WorkspaceOutcome => ({ ok: false, error });

export function seedWorkspace(closedAt: string): Workspace {
  const venue = seedVenue(closedAt);
  return {
    version: WORKSPACE_VERSION,
    activeVenueId: venue.id,
    venues: [venue],
    viewAsMemberId: null,
  };
}

export function activeVenue(workspace: Workspace): Venue {
  const venue =
    workspace.venues.find((v) => v.id === workspace.activeVenueId) ?? workspace.venues[0];
  if (!venue) throw new Error('El espacio de trabajo no tiene locales.');
  return venue;
}

/** Ejecuta una acción del modelo sobre el local activo. */
export function applyToActiveVenue(
  workspace: Workspace,
  action: (venue: Venue) => Outcome,
): WorkspaceOutcome {
  const current = activeVenue(workspace);
  const outcome = action(current);
  if (!outcome.ok) return outcome;
  const updated: Workspace = {
    ...workspace,
    venues: workspace.venues.map((v) => (v.id === current.id ? outcome.venue : v)),
  };
  // Si se quitó el acceso de quien se estaba simulando, se vuelve a la vista del encargado.
  const stillThere = outcome.venue.members.some((m) => m.id === workspace.viewAsMemberId);
  return { ok: true, workspace: stillThere ? updated : { ...updated, viewAsMemberId: null } };
}

function nameTaken(workspace: Workspace, name: string, exceptId?: string): boolean {
  const lower = name.toLowerCase();
  return workspace.venues.some((v) => v.id !== exceptId && v.name.toLowerCase() === lower);
}

/**
 * Crea un local y lo deja activo. Opcionalmente copia los puestos (con sus factores) de otro
 * local; el personal no se copia.
 */
export function createVenue(
  workspace: Workspace,
  params: { id: string; name: string; copyPositionsFrom?: string | null },
): WorkspaceOutcome {
  const name = params.name.trim();
  if (name === '') return fail('Poné un nombre para el local.');
  if (nameTaken(workspace, name)) return fail(`Ya existe un local llamado "${name}".`);
  const source = params.copyPositionsFrom
    ? workspace.venues.find((v) => v.id === params.copyPositionsFrom)
    : undefined;
  if (params.copyPositionsFrom && !source) return fail('El local a copiar no existe.');
  const venue = emptyVenue(params.id, name, source?.positions ?? []);
  return {
    ok: true,
    workspace: {
      ...workspace,
      activeVenueId: venue.id,
      venues: [...workspace.venues, venue],
      viewAsMemberId: null,
    },
  };
}

/** Cambia de local. La simulación "Ver como…" es de un local, así que se apaga. */
export function setActiveVenue(workspace: Workspace, venueId: string): WorkspaceOutcome {
  if (!workspace.venues.some((v) => v.id === venueId)) return fail('Ese local no existe.');
  return { ok: true, workspace: { ...workspace, activeVenueId: venueId, viewAsMemberId: null } };
}

export function renameVenue(workspace: Workspace, venueId: string, name: string): WorkspaceOutcome {
  const trimmed = name.trim();
  if (trimmed === '') return fail('Poné un nombre para el local.');
  if (!workspace.venues.some((v) => v.id === venueId)) return fail('Ese local no existe.');
  if (nameTaken(workspace, trimmed, venueId))
    return fail(`Ya existe un local llamado "${trimmed}".`);
  return {
    ok: true,
    workspace: {
      ...workspace,
      venues: workspace.venues.map((v) => (v.id === venueId ? { ...v, name: trimmed } : v)),
    },
  };
}

/** Activa (`memberId`) o apaga (`null`) la simulación "Ver como…" en el local activo. */
export function setViewAs(workspace: Workspace, memberId: string | null): WorkspaceOutcome {
  if (memberId !== null && !activeVenue(workspace).members.some((m) => m.id === memberId)) {
    return fail('Esa persona no tiene acceso a este local.');
  }
  return { ok: true, workspace: { ...workspace, viewAsMemberId: memberId } };
}

/**
 * Interpreta lo guardado en el navegador. Acepta el formato actual y el de la versión 1
 * (un único restaurante), que se convierte en un local. Devuelve null si no sirve.
 */
export function parseStoredWorkspace(value: unknown): Workspace | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (v.version === WORKSPACE_VERSION) {
    const raw = Array.isArray(v.venues) ? v.venues : [];
    const venues = raw.map(normalizeVenue);
    if (venues.length === 0 || venues.some((venue) => venue === null)) return null;
    const valid = venues as Venue[];
    const active = valid.find((venue) => venue.id === v.activeVenueId) ?? (valid[0] as Venue);
    const viewAsMemberId =
      typeof v.viewAsMemberId === 'string' && active.members.some((m) => m.id === v.viewAsMemberId)
        ? v.viewAsMemberId
        : null;
    return { version: WORKSPACE_VERSION, activeVenueId: active.id, venues: valid, viewAsMemberId };
  }

  if (v.version === 1) {
    const legacy = normalizeVenue({
      id: 'local-demo',
      name: typeof v.restaurantName === 'string' ? v.restaurantName : 'Mi local',
      positions: v.positions,
      staff: v.staff,
      weeks: v.weeks,
    });
    if (!legacy) return null;
    return {
      version: WORKSPACE_VERSION,
      activeVenueId: legacy.id,
      venues: [legacy],
      viewAsMemberId: null,
    };
  }

  return null;
}
