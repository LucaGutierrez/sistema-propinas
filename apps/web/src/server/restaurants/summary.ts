/**
 * Resumen del restaurante para el inicio (modo base de datos). Solo cuenta filas del restaurante
 * indicado: el `restaurantId` sale de `requireAccess`, nunca del navegador.
 */
import type { DbClient } from '../policy/repository';

export interface RestaurantSummary {
  name: string;
  /** Número de la versión vigente de la política (null si todavía no tiene). */
  policyVersion: number | null;
  activeEmployees: number;
  distributions: number;
  periods: number;
  advances: number;
  payments: number;
}

export async function getRestaurantSummary(
  db: DbClient,
  restaurantId: string,
): Promise<RestaurantSummary | null> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, currentPolicyVersion: { select: { number: true } } },
  });
  if (!restaurant) return null;
  const where = { restaurantId };
  const [activeEmployees, distributions, periods, advances, payments] = await Promise.all([
    db.employee.count({ where: { restaurantId, active: true, archivedAt: null } }),
    db.dailyDistribution.count({ where }),
    db.weeklySettlement.count({ where }),
    db.advance.count({ where }),
    db.weeklyPayment.count({ where }),
  ]);
  return {
    name: restaurant.name,
    policyVersion: restaurant.currentPolicyVersion?.number ?? null,
    activeEmployees,
    distributions,
    periods,
    advances,
    payments,
  };
}
