/**
 * `requireAccess` para Server Components y Server Actions: LA autoridad de autorización.
 * Toma la sesión real del pedido (cookie validada por Better Auth), resuelve el restaurante y
 * verifica membresía y rol (`authorize`). La interfaz puede ocultar botones, pero cada acción
 * del servidor vuelve a llamar acá.
 *
 * Rendimiento: el acceso al restaurante ACTIVO se resuelve una sola vez por pedido (`cache` de
 * React) y se reutiliza en el layout y en la página; cada llamada vuelve a comprobar el rol que
 * pide. Nada se guarda entre pedidos.
 */
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getSessionUser, type SessionUser } from '../auth/session';
import { getDb } from '../db';
import {
  AccessDenied,
  assertRole,
  authorize,
  pickActiveRestaurant,
  type AccessContext,
} from './access';
import { ROLES, type Role } from './roles';

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

type ActiveAccess = { ok: true; access: AccessContext } | { ok: false; error: AccessDenied };

/**
 * Acceso del usuario de la sesión a su restaurante activo, con su rol (cualquiera), una sola vez
 * por pedido. Los errores de acceso también se memorizan (se vuelven a lanzar en cada llamada).
 */
export const getActiveAccess = cache(async (): Promise<ActiveAccess> => {
  try {
    const access = await authorize(getDb(), await getSessionUser(), {
      preferredRestaurantId: await preferredRestaurantId(),
      roles: ROLES,
    });
    return { ok: true, access };
  } catch (error) {
    if (error instanceof AccessDenied) return { ok: false, error };
    throw error;
  }
});

/**
 * Exige sesión + membresía con uno de `roles` en `restaurantId` (o, si no se indica, en el
 * restaurante activo del usuario). Lanza `AccessDenied` si no.
 */
export async function requireAccess(input: {
  restaurantId?: string;
  roles: readonly Role[];
}): Promise<AccessContext> {
  if (input.restaurantId !== undefined) {
    return authorize(getDb(), await getSessionUser(), {
      restaurantId: input.restaurantId,
      roles: input.roles,
    });
  }
  const active = await getActiveAccess();
  if (!active.ok) throw active.error;
  assertRole(active.access, input.roles);
  return active.access;
}
