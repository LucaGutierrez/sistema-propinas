/**
 * Contraseña (cuenta "credential" de Better Auth) de un usuario QUE YA EXISTE.
 *
 * Es el puente entre los usuarios creados antes de Better Auth (p. ej. el dueño que creó
 * db:bootstrap en Neon) y el login: no crea ni duplica usuarios, solo agrega su fila en
 * `accounts` con el mismo hash que usa Better Auth (scrypt de `better-auth/crypto`), así que
 * después se inicia sesión por el flujo normal.
 */
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import type { ServiceResult } from '../policy/service';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth';

export const CREDENTIAL_PROVIDER = 'credential';

export interface SetPasswordResult {
  userId: string;
  /** false si reemplazó una contraseña existente (--reset). */
  created: boolean;
  /** Sesiones cerradas al reemplazar la contraseña. */
  revokedSessions: number;
}

const fail = <T>(error: string): ServiceResult<T> => ({ ok: false, error });

export async function setCredentialPassword(
  db: PrismaClient,
  emailInput: string,
  password: string,
  options: { reset?: boolean } = {},
): Promise<ServiceResult<SetPasswordResult>> {
  const email = emailInput.trim().toLowerCase();
  if (!email.includes('@')) return fail('El email no es válido.');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return fail(`La contraseña puede tener hasta ${MAX_PASSWORD_LENGTH} caracteres.`);
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return fail('No existe un usuario con ese email (se crea con db:bootstrap).');

  const key = { providerId: CREDENTIAL_PROVIDER, accountId: user.id };
  const existing = await db.account.findUnique({
    where: { providerId_accountId: key },
    select: { id: true },
  });
  if (existing && !options.reset) {
    return fail('Ese usuario ya tiene contraseña. Para reemplazarla usá --reset.');
  }

  // Hash fuera de la transacción: scrypt es lento a propósito.
  const hash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    if (existing) {
      await tx.account.update({ where: { id: existing.id }, data: { password: hash } });
      // Contraseña nueva: se cierran todas las sesiones abiertas con la anterior.
      const revoked = await tx.session.deleteMany({ where: { userId: user.id } });
      return {
        ok: true,
        value: { userId: user.id, created: false, revokedSessions: revoked.count },
      };
    }
    await tx.account.create({ data: { ...key, userId: user.id, password: hash } });
    return { ok: true, value: { userId: user.id, created: true, revokedSessions: 0 } };
  });
}
