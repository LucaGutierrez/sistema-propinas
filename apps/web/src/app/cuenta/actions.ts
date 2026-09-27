'use server';

/**
 * Elegir el restaurante activo. Solo guarda una PREFERENCIA (cookie httpOnly) y solo si el
 * usuario de la sesión es miembro: el acceso se vuelve a verificar en cada pedido igual.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isUuid, listUserRestaurants } from '@/server/access/access';
import { ACTIVE_RESTAURANT_COOKIE } from '@/server/access/request';
import { getSessionUser } from '@/server/auth/session';
import { getDb } from '@/server/db';

export async function selectRestaurantAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Fcuenta');
  const restaurantId = String(formData.get('restaurantId') ?? '');
  if (!isUuid(restaurantId)) return;
  const mine = await listUserRestaurants(getDb(), user.id);
  if (!mine.some((r) => r.restaurantId === restaurantId)) return;
  (await cookies()).set(ACTIVE_RESTAURANT_COOKIE, restaurantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/cuenta');
}
