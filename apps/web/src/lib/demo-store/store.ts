'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Member, Outcome, Venue } from './model';
import { effectivePermissions } from './permissions';
import {
  activeVenue,
  applyToActiveVenue,
  parseStoredWorkspace,
  seedWorkspace,
  type Workspace,
  type WorkspaceOutcome,
} from './workspace';

/*
 * Datos de la demo guardados en el navegador (localStorage). Es solo para probar el flujo:
 * cada navegador tiene su copia y no se comparte. La versión real guardará en la base de datos.
 */
const STORAGE_KEY = 'gutip-demo-v2';
/** Formato anterior (un solo restaurante): se migra al leerlo. */
const LEGACY_KEY = 'gutip-demo-v1';

let current: Workspace | null = null;
const listeners = new Set<() => void>();

function readKey(key: string): Workspace | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseStoredWorkspace(JSON.parse(raw)) : null;
  } catch {
    return null; // Sin acceso al almacenamiento o datos corruptos.
  }
}

function read(): Workspace {
  return readKey(STORAGE_KEY) ?? readKey(LEGACY_KEY) ?? seedWorkspace(new Date().toISOString());
}

function write(workspace: Workspace) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // Si no se puede guardar, la demo sigue funcionando en memoria.
  }
}

function getSnapshot(): Workspace {
  if (current === null) {
    current = read();
    write(current);
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    current = null; // Otra pestaña cambió los datos: se relee.
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setWorkspace(workspace: Workspace) {
  current = workspace;
  write(workspace);
  for (const listener of listeners) listener();
}

/**
 * Datos de la demo. `workspace` y `venue` (el local activo) son `null` durante el render del
 * servidor y la hidratación. `apply` ejecuta una acción sobre el local activo y
 * `applyWorkspace` una sobre el espacio de trabajo; ambas devuelven el error, si lo hubo.
 */
export function useDemoStore() {
  const workspace = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const venue: Venue | null = workspace ? activeVenue(workspace) : null;
  /** Miembro simulado con "Ver como…", o null si se ve como el encargado. */
  const viewAs: Member | null =
    venue?.members.find((m) => m.id === workspace?.viewAsMemberId) ?? null;
  const perms = effectivePermissions(viewAs);

  const applyWorkspace = useCallback(
    (action: (workspace: Workspace) => WorkspaceOutcome): string | null => {
      const outcome = action(getSnapshot());
      if (!outcome.ok) return outcome.error;
      setWorkspace(outcome.workspace);
      return null;
    },
    [],
  );
  const apply = useCallback(
    (action: (venue: Venue) => Outcome): string | null =>
      applyWorkspace((ws) => applyToActiveVenue(ws, action)),
    [applyWorkspace],
  );
  const reset = useCallback(() => setWorkspace(seedWorkspace(new Date().toISOString())), []);

  return { workspace, venue, viewAs, perms, apply, applyWorkspace, reset };
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36);
  return `${prefix}-${random}`;
}
