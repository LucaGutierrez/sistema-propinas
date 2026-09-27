/**
 * Contexto de acceso del servidor: qué restaurante se opera y quién opera.
 *
 * TODAVÍA NO HAY AUTENTICACIÓN (Better Auth llega después). Mientras tanto el contexto es
 * explícito y se configura por variables de entorno del servidor, solo para desarrollo:
 *
 *   GUTIP_DATA_SOURCE=database        activa la base de datos (sin esto, la pantalla usa la demo)
 *   GUTIP_RESTAURANT_ID=<uuid>        restaurante que se opera (el creado con `db:bootstrap`)
 *   GUTIP_OPERATOR_EMAIL=<email>      usuario operador (creado por `db:bootstrap`)
 *
 * Aun así, el acceso se verifica contra la base: el operador tiene que tener una membresía en
 * ese restaurante. Cuando exista la sesión, `requireAccess(restaurantId, capacidad)` reemplaza
 * a `resolveAccess` y el resto de la capa (repositorio y servicios) no cambia: ya recibe el
 * restaurante y el usuario como parámetros.
 */
import type { MembershipRole } from '@prisma/client';
import type { Db } from './db';

export interface AccessContext {
  restaurantId: string;
  userId: string;
  userName: string;
  role: MembershipRole;
  /** Puede cambiar la política de distribución. Provisional hasta los permisos reales (§11). */
  canConfigure: boolean;
}

export class AccessError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿La pantalla lee y escribe la base de datos? (Si no, usa la demo del navegador.) */
export function databaseEnabled(): boolean {
  return process.env.GUTIP_DATA_SOURCE === 'database';
}

/** Restaurante y operador configurados (sin consultar la base). */
export function configuredOperator(): { restaurantId: string; email: string } {
  const restaurantId = process.env.GUTIP_RESTAURANT_ID?.trim() ?? '';
  const email = process.env.GUTIP_OPERATOR_EMAIL?.trim().toLowerCase() ?? '';
  if (!UUID.test(restaurantId)) {
    throw new AccessError('Falta GUTIP_RESTAURANT_ID (un uuid) en la configuración del servidor.');
  }
  if (!email.includes('@')) {
    throw new AccessError('Falta GUTIP_OPERATOR_EMAIL en la configuración del servidor.');
  }
  return { restaurantId, email };
}

/** Verifica en la base que el operador sea miembro del restaurante. */
export async function resolveAccess(
  db: Db,
  operator: { restaurantId: string; email: string },
): Promise<AccessContext> {
  const membership = await db.membership.findFirst({
    where: { restaurantId: operator.restaurantId, user: { email: operator.email } },
    select: { role: true, user: { select: { id: true, name: true } } },
  });
  if (!membership) {
    throw new AccessError(
      'El operador configurado no tiene acceso a ese restaurante (o el restaurante no existe). ¿Corriste db:bootstrap?',
    );
  }
  return {
    restaurantId: operator.restaurantId,
    userId: membership.user.id,
    userName: membership.user.name,
    role: membership.role,
    canConfigure: membership.role === 'OWNER' || membership.role === 'ADMIN',
  };
}
