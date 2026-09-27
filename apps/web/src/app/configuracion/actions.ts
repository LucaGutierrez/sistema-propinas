'use server';

/**
 * Acciones de "Configuración de distribución" contra la base de datos. En CADA llamada
 * `requireAccess` vuelve a resolver el acceso en el servidor: usuario de la sesión (Better Auth),
 * restaurante activo verificado contra sus membresías y rol que puede configurar. Del navegador
 * solo llegan los datos del cambio; nunca el restaurante, el usuario ni el rol.
 */
import { revalidatePath } from 'next/cache';
import { PARAMS, type ParamKey } from '@/lib/demo-store/config';
import { AccessDenied } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { changeDistributionConfig } from '@/server/policy/commands';
import type { PolicyChangeRequest } from '@/server/policy/service';

const DENIED: Record<AccessDenied['reason'], string> = {
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a iniciar sesión.',
  NOT_FOUND: 'No se encontró el restaurante.',
  FORBIDDEN: 'Tu rol no permite cambiar la configuración.',
};

async function run(request: PolicyChangeRequest): Promise<string | null> {
  if (!databaseEnabled()) return 'La base de datos no está activada en este servidor.';
  try {
    const access = await requireAccess({ roles: CAN.editDistributionConfig });
    const result = await changeDistributionConfig(getDb(), access, request);
    if (!result.ok) return result.error;
    revalidatePath('/configuracion');
    return null;
  } catch (error) {
    if (error instanceof AccessDenied) return DENIED[error.reason];
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
