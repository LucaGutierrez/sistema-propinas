/**
 * `requireAccess` para Server Components y Server Actions: LA autoridad de autorización.
 * Toma la sesión real del pedido (cookie validada por Better Auth), resuelve el restaurante y
 * verifica membresía y rol (`authorize`). La interfaz puede ocultar botones, pero cada acción
 * del servidor vuelve a llamar acá.
 */
import { cookies } from 'next/headers';
import { getSessionUser, type SessionUser } from '../auth/session';
import { getDb } from '../db';
import { authorize, pickActiveRestaurant, type AccessContext } from './access';
import type { Role } from './roles';

/** Restaurante elegido por el usuario (solo una preferencia; se valida contra memberships). */
export const ACTIVE_RESTAURANT_COOKIE = 'gutip_restaurant';

async function preferredRestaurantId(): Promise<string | undefined> {
  return (await cookies()).get(ACTIVE_RESTAURANT_COOKIE)?.value;
}

/**
 * Guarda la preferencia de restaurante activo (cookie httpOnly). Llamar SOLO después de verificar
 * que el usuario es miembro; igual, `authorize` la vuelve a validar en cada pedido.
 */
export async function setActiveRestaurantCookie(restaurantId: string): Promise<void> {
  (await cookies()).set(ACTIVE_RESTAURANT_COOKIE, restaurantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Restaurante activo del usuario, o null si no es miembro de ninguno. */
export async function activeRestaurantId(user: SessionUser): Promise<string | null> {
  return pickActiveRestaurant(getDb(), user.id, await preferredRestaurantId());
}

/**
 * Exige sesión + membresía con uno de `roles` en `restaurantId` (o, si no se indica, en el
 * restaurante activo del usuario). Lanza `AccessDenied` si no.
 */
export async function requireAccess(input: {
  restaurantId?: string;
  roles: readonly Role[];
}): Promise<AccessContext> {
  return authorize(getDb(), await getSessionUser(), {
    ...input,
    preferredRestaurantId: await preferredRestaurantId(),
  });
}
