/**
 * Acceso al local: a quién invita el encargado y con qué permiso.
 * En la demo las invitaciones quedan pendientes; con el login, la persona las aceptará.
 */
import type { Member, Outcome, Role, Venue } from './model';

const fail = (error: string): Outcome => ({ ok: false, error });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ROLES: readonly Role[] = ['ENCARGADO', 'EDITOR', 'LECTOR', 'PROPIO'];

function validate(venue: Venue, member: Member, exceptId?: string): string | null {
  if (member.name.trim() === '') return 'Poné el nombre de la persona.';
  if (member.email !== '' && !EMAIL.test(member.email)) return 'El email no es válido.';
  const others = venue.members.filter((m) => m.id !== exceptId);
  if (
    member.email !== '' &&
    others.some((m) => m.email.toLowerCase() === member.email.toLowerCase())
  ) {
    return 'Ya hay una invitación con ese email.';
  }
  if (member.staffId !== null) {
    const staff = venue.staff.find((s) => s.id === member.staffId);
    if (!staff) return 'Esa persona no está en el personal del local.';
    if (others.some((m) => m.staffId === member.staffId)) {
      return `${staff.name} ya tiene acceso a este local.`;
    }
  }
  if (member.role === 'PROPIO' && member.staffId === null) {
    return 'Para "Solo lo suyo" elegí quién es en el personal: así ve su propio sobre.';
  }
  return null;
}

export function inviteMember(
  venue: Venue,
  params: {
    id: string;
    name: string;
    email: string;
    role: Role;
    staffId: string | null;
    invitedAt: string;
  },
): Outcome {
  const member: Member = {
    id: params.id,
    name: params.name.trim(),
    email: params.email.trim(),
    role: params.role,
    staffId: params.staffId,
    status: 'INVITADO',
    invitedAt: params.invitedAt,
  };
  const error = validate(venue, member);
  if (error) return fail(error);
  return { ok: true, venue: { ...venue, members: [...venue.members, member] } };
}

export function updateMember(
  venue: Venue,
  memberId: string,
  changes: Partial<Pick<Member, 'role' | 'staffId'>>,
): Outcome {
  const current = venue.members.find((m) => m.id === memberId);
  if (!current) return fail('Esa persona no tiene acceso a este local.');
  const updated: Member = { ...current, ...changes };
  const error = validate(venue, updated, memberId);
  if (error) return fail(error);
  return {
    ok: true,
    venue: { ...venue, members: venue.members.map((m) => (m.id === memberId ? updated : m)) },
  };
}

/** Quita el acceso. No toca el personal ni las semanas: solo deja de poder entrar. */
export function removeMember(venue: Venue, memberId: string): Outcome {
  if (!venue.members.some((m) => m.id === memberId)) {
    return fail('Esa persona no tiene acceso a este local.');
  }
  return { ok: true, venue: { ...venue, members: venue.members.filter((m) => m.id !== memberId) } };
}
