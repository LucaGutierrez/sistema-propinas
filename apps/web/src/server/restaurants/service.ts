/**
 * Alta de un restaurante por un usuario con sesión: en UNA transacción crea el restaurante, la
 * membresía OWNER de quien lo crea (el dueño es uno solo: índice ux_memberships_one_owner) y la
 * política estándar v1 vigente. Todo o nada.
 */
import type { PrismaClient } from '@prisma/client';
import { AccessDenied } from '../access/access';
import type { SessionUser } from '../auth/session';
import { createTemplatePolicyInTx, TX_OPTIONS, type ServiceResult } from '../policy/service';

export const MAX_RESTAURANT_NAME = 120;

class CreateAborted extends Error {}

export async function createRestaurant(
  db: PrismaClient,
  user: SessionUser | null,
  nameInput: string,
): Promise<ServiceResult<{ restaurantId: string; versionId: string }>> {
  if (!user) throw new AccessDenied('UNAUTHENTICATED');
  const name = nameInput.trim();
  if (name === '') return { ok: false, error: 'Poné un nombre para el restaurante.' };
  if (name.length > MAX_RESTAURANT_NAME) {
    return { ok: false, error: `El nombre puede tener hasta ${MAX_RESTAURANT_NAME} caracteres.` };
  }

  try {
    return await db.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({ data: { name }, select: { id: true } });
      await tx.membership.create({
        data: { userId: user.id, restaurantId: restaurant.id, role: 'OWNER' },
      });
      const policy = await createTemplatePolicyInTx(tx, {
        restaurantId: restaurant.id,
        userId: user.id,
      });
      if (!policy.ok) throw new CreateAborted(policy.error);
      return {
        ok: true as const,
        value: { restaurantId: restaurant.id, versionId: policy.value.versionId },
      };
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof CreateAborted) return { ok: false, error: error.message };
    throw error;
  }
}
