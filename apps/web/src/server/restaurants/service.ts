/**
 * Alta de un restaurante por un usuario con sesión: en UNA transacción crea el restaurante, la
 * membresía OWNER de quien lo crea (el dueño es uno solo: índice ux_memberships_one_owner) y la
 * política estándar v1 vigente (la MISMA plantilla que db:bootstrap: `STANDARD_TEMPLATE`, con sus
 * puestos y porciones). Todo o nada: si algo falla, no queda ni el restaurante, ni la membresía,
 * ni una política a medias.
 *
 * El restaurante nace vacío: sin personal, repartos, períodos, adelantos ni pagos. No copia nada
 * de otros restaurantes.
 */
import type { PrismaClient } from '@prisma/client';
import { STANDARD_TEMPLATE, type PolicyTemplate } from '@/lib/policy/standard';
import { AccessDenied } from '../access/access';
import type { SessionUser } from '../auth/session';
import { createTemplatePolicyInTx, TX_OPTIONS, type ServiceResult } from '../policy/service';

export const MAX_RESTAURANT_NAME = 120;

/** Restaurantes que una misma cuenta puede crear (freno al abuso del registro público). */
export const MAX_OWNED_RESTAURANTS = 10;

class CreateAborted extends Error {}

export async function createRestaurant(
  db: PrismaClient,
  user: SessionUser | null,
  nameInput: string,
  template: PolicyTemplate = STANDARD_TEMPLATE,
): Promise<ServiceResult<{ restaurantId: string; versionId: string }>> {
  if (!user) throw new AccessDenied('UNAUTHENTICATED');
  const name = nameInput.trim();
  if (name === '') return { ok: false, error: 'Poné un nombre para el restaurante.' };
  if (name.length > MAX_RESTAURANT_NAME) {
    return { ok: false, error: `El nombre puede tener hasta ${MAX_RESTAURANT_NAME} caracteres.` };
  }

  try {
    return await db.$transaction(async (tx) => {
      // Bloquea al usuario: dos altas simultáneas de la misma cuenta se ordenan (tope confiable).
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      if (locked.length !== 1) throw new CreateAborted('Tu cuenta no existe.');
      const owned = await tx.membership.count({ where: { userId: user.id, role: 'OWNER' } });
      if (owned >= MAX_OWNED_RESTAURANTS) {
        throw new CreateAborted(
          `Llegaste al máximo de ${MAX_OWNED_RESTAURANTS} restaurantes por cuenta.`,
        );
      }

      const restaurant = await tx.restaurant.create({ data: { name }, select: { id: true } });
      await tx.membership.create({
        data: { userId: user.id, restaurantId: restaurant.id, role: 'OWNER' },
      });
      const policy = await createTemplatePolicyInTx(
        tx,
        { restaurantId: restaurant.id, userId: user.id },
        template,
      );
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
