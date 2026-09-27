/**
 * Casos de uso de la política sobre un contexto YA autorizado por `requireAccess`. Cada uno
 * vuelve a comprobar el rol (defensa en profundidad) y opera solo sobre `access.restaurantId`.
 */
import { assertRole, type AccessContext } from '../access/access';
import { CAN, roleAllowed } from '../access/roles';
import type { Db } from '../db';
import type { DistributionConfigView } from '@/lib/policy/view';
import { getDistributionConfigView } from './repository';
import {
  changePolicy,
  type PolicyChangeRequest,
  type PolicyChangeResult,
  type ServiceResult,
} from './service';

/**
 * Configuración del restaurante del contexto (null si todavía no tiene política). `canEdit`
 * solo decide qué muestra la pantalla: cada cambio vuelve a verificar el rol.
 */
export async function loadDistributionConfig(
  db: Db,
  access: AccessContext,
): Promise<DistributionConfigView | null> {
  assertRole(access, CAN.viewDistributionConfig);
  return getDistributionConfigView(db, {
    restaurantId: access.restaurantId,
    canConfigure: roleAllowed(access.role, CAN.editDistributionConfig),
  });
}

/** Cambia la política (crea una versión nueva a nombre de `access.userId`). */
export async function changeDistributionConfig(
  db: Db,
  access: AccessContext,
  request: PolicyChangeRequest,
): Promise<ServiceResult<PolicyChangeResult>> {
  assertRole(access, CAN.editDistributionConfig);
  return changePolicy(db, { restaurantId: access.restaurantId, userId: access.userId }, request);
}
