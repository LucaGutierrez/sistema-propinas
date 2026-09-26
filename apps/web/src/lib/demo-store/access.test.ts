import { describe, expect, it } from 'vitest';
import { inviteMember, removeMember, updateMember } from './members';
import { seedVenue, setStaffActive, type Outcome, type Role, type Venue } from './model';
import { effectivePermissions, permissionsFor } from './permissions';
import {
  applyToActiveVenue,
  createVenue,
  seedWorkspace,
  setActiveVenue,
  setViewAs,
  type WorkspaceOutcome,
} from './workspace';

const NOW = '2026-09-26T12:00:00.000Z';

function ok(outcome: Outcome): Venue {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.venue;
}

function err(outcome: Outcome | WorkspaceOutcome): string {
  if (outcome.ok) throw new Error('Se esperaba un error');
  return outcome.error;
}

const invite = (venue: Venue, name: string, role: Role, staffId: string | null, email = '') =>
  inviteMember(venue, { id: `m-${name}`, name, email, role, staffId, invitedAt: NOW });

describe('permisos', () => {
  it('cada permiso habilita exactamente lo acordado', () => {
    const table = (['ENCARGADO', 'EDITOR', 'LECTOR', 'PROPIO'] as const).map((role) => {
      const p = permissionsFor(role);
      return [role, p.viewAll, p.editWeek, p.closeWeek, p.manageStaff, p.manageAccess];
    });
    expect(table).toEqual([
      ['ENCARGADO', true, true, true, true, true],
      ['EDITOR', true, true, false, false, false],
      ['LECTOR', true, false, false, false, false],
      ['PROPIO', false, false, false, false, false],
    ]);
  });

  it('sin "Ver como…" se ve como el encargado; con él, con el permiso del miembro', () => {
    expect(effectivePermissions(null).role).toBe('ENCARGADO');
    const venue = seedVenue(NOW);
    const nahuel = venue.members.find((m) => m.id === 'miembro-nahuel') ?? null;
    expect(effectivePermissions(nahuel)).toMatchObject({ role: 'PROPIO', ownStaffId: 'nahuel' });
  });
});

describe('invitaciones', () => {
  const venue = seedVenue(NOW);

  it('invita con permiso y queda pendiente', () => {
    const updated = ok(invite(venue, 'Isaías', 'LECTOR', 'isaias', 'isaias@ejemplo.com'));
    expect(updated.members.at(-1)).toMatchObject({
      name: 'Isaías',
      role: 'LECTOR',
      staffId: 'isaias',
      status: 'INVITADO',
    });
  });

  it('"Solo lo suyo" exige saber quién es en el personal', () => {
    expect(err(invite(venue, 'Alguien', 'PROPIO', null))).toMatch(/Solo lo suyo/);
    expect(err(updateMember(venue, 'miembro-leo', { staffId: null, role: 'PROPIO' }))).toMatch(
      /Solo lo suyo/,
    );
  });

  it('no repite personas ni emails, y valida el email', () => {
    expect(err(invite(venue, 'Leo otra vez', 'LECTOR', 'leo'))).toMatch(/ya tiene acceso/);
    const withEmail = ok(invite(venue, 'Ana', 'LECTOR', null, 'ana@ejemplo.com'));
    expect(err(invite(withEmail, 'Ana 2', 'LECTOR', null, 'ANA@ejemplo.com'))).toMatch(/email/);
    expect(err(invite(venue, 'Ana', 'LECTOR', null, 'no-es-email'))).toMatch(/email/);
    expect(err(invite(venue, 'Nadie', 'LECTOR', 'no-existe'))).toMatch(/personal/);
  });

  it('cambia el permiso y quita el acceso sin tocar al personal', () => {
    let updated = ok(updateMember(venue, 'miembro-leo', { role: 'LECTOR' }));
    expect(updated.members.find((m) => m.id === 'miembro-leo')?.role).toBe('LECTOR');
    updated = ok(removeMember(updated, 'miembro-leo'));
    expect(updated.members.some((m) => m.id === 'miembro-leo')).toBe(false);
    expect(updated.staff.some((s) => s.id === 'leo')).toBe(true);
  });

  it('dar de baja a alguien del personal no le borra el acceso', () => {
    const updated = ok(setStaffActive(venue, 'nahuel', false));
    expect(updated.members.some((m) => m.staffId === 'nahuel')).toBe(true);
  });
});

describe('"Ver como…"', () => {
  it('solo con miembros del local activo, y se apaga al cambiar de local', () => {
    let ws = seedWorkspace(NOW);
    const on = setViewAs(ws, 'miembro-leo');
    if (!on.ok) throw new Error(on.error);
    ws = on.workspace;
    expect(ws.viewAsMemberId).toBe('miembro-leo');

    const created = createVenue(ws, { id: 'mercado', name: 'Faena Mercado' });
    if (!created.ok) throw new Error(created.error);
    expect(created.workspace.viewAsMemberId).toBeNull();
    expect(err(setViewAs(created.workspace, 'miembro-leo'))).toMatch(/no tiene acceso/);

    const back = setActiveVenue(created.workspace, 'local-demo');
    if (!back.ok) throw new Error(back.error);
    expect(back.workspace.viewAsMemberId).toBeNull();
  });

  it('si se le quita el acceso a quien se está simulando, se vuelve a la vista propia', () => {
    const on = setViewAs(seedWorkspace(NOW), 'miembro-leo');
    if (!on.ok) throw new Error(on.error);
    const removed = applyToActiveVenue(on.workspace, (v) => removeMember(v, 'miembro-leo'));
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.workspace.viewAsMemberId).toBeNull();
  });
});
