'use server';

/**
 * Crear un restaurante. Quién lo crea sale de la sesión (Better Auth), nunca del navegador; queda
 * como OWNER y el restaurante nace con la política estándar v1 (ver server/restaurants/service).
 */
import { redirect } from 'next/navigation';
import { setActiveRestaurantCookie } from '@/server/access/request';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { createRestaurantInput } from '@/server/restaurants/schemas';
import { createRestaurant } from '@/server/restaurants/service';

export async function createRestaurantAction(name: string): Promise<string | null> {
  if (!databaseEnabled()) return 'La base de datos no está activada en este servidor.';
  const parsed = createRestaurantInput.safeParse({ name });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Ese nombre no es válido.';

  const user = await getSessionUser();
  if (!user) return 'Tu sesión terminó. Volvé a iniciar sesión.';

  let restaurantId: string;
  try {
    const result = await createRestaurant(getDb(), user, parsed.data.name);
    if (!result.ok) return result.error;
    restaurantId = result.value.restaurantId;
  } catch (error) {
    console.error('[crear-restaurante] no se pudo crear el restaurante', error);
    return 'No se pudo crear el restaurante. Probá de nuevo.';
  }
  // El nuevo restaurante pasa a ser el activo (el usuario acaba de verificarse como su OWNER).
  await setActiveRestaurantCookie(restaurantId);
  redirect('/');
}
