'use server';

/**
 * Acciones de "Configuración de distribución" contra la base de datos. El acceso se resuelve
 * en el servidor en cada llamada (nunca se confía en lo que manda el navegador) y la lógica
 * vive en el servicio de dominio (`server/policy/service.ts`).
 */
import { revalidatePath } from 'next/cache';
import { PARAMS, type ParamKey } from '@/lib/demo-store/config';
import { AccessError, configuredOperator, databaseEnabled, resolveAccess } from '@/server/context';
import { getDb } from '@/server/db';
import { changePolicy, type PolicyChangeRequest } from '@/server/policy/service';

async function run(request: PolicyChangeRequest): Promise<string | null> {
  if (!databaseEnabled()) return 'La base de datos no está activada en este servidor.';
  try {
    const db = getDb();
    const access = await resolveAccess(db, configuredOperator());
    if (!access.canConfigure) return 'Solo el Encargado puede cambiar la configuración.';
    const result = await changePolicy(
      db,
      { restaurantId: access.restaurantId, userId: access.userId },
      request,
    );
    if (!result.ok) return result.error;
    revalidatePath('/configuracion');
    return null;
  } catch (error) {
    if (error instanceof AccessError) return error.message;
    console.error('[configuracion] no se pudo guardar el cambio de política', error);
    return 'No se pudo guardar el cambio. Probá de nuevo.';
  }
}

export async function setPolicyValueAction(key: ParamKey, value: string): Promise<string | null> {
  if (!PARAMS.some((p) => p.key === key)) return 'Ese parámetro no existe.';
  return run({ kind: 'value', key, value: String(value) });
}

export async function addPositionAction(name: string, factor: string): Promise<string | null> {
  return run({ kind: 'addPosition', name: String(name), factor: String(factor) });
}

export async function setPortionAction(positionId: string, factor: string): Promise<string | null> {
  return run({ kind: 'portion', positionId: String(positionId), factor: String(factor) });
}
