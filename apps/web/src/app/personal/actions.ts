'use server';

/**
 * Acciones de "Personal" contra la base de datos. En CADA llamada `requireAccess` vuelve a
 * resolver el acceso en el servidor: usuario de la sesión, restaurante activo verificado contra
 * sus membresías y rol que puede gestionar el personal. Del navegador solo llegan los datos del
 * cambio (validados con Zod); nunca el restaurante, el usuario ni el rol.
 */
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import type { ServiceResult } from '@/server/policy/service';
import {
  addStaffInput,
  firstIssue,
  setStaffActiveInput,
  setStaffPositionInput,
} from '@/server/staff/schemas';
import { addEmployee, setEmployeeActive, setEmployeePosition } from '@/server/staff/service';

const DENIED: Record<AccessDenied['reason'], string> = {
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a iniciar sesión.',
  NOT_FOUND: 'No se encontró el restaurante.',
  FORBIDDEN: 'Tu rol no permite cambiar el personal.',
};

async function run<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  change: (access: AccessContext, input: z.infer<S>) => Promise<ServiceResult<unknown>>,
): Promise<string | null> {
  if (!databaseEnabled()) return 'La base de datos no está activada en este servidor.';
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const access = await requireAccess({ roles: CAN.manageStaff });
    const result = await change(access, parsed.data);
    if (!result.ok) return result.error;
    revalidatePath('/personal');
    // "Configuración de distribución" muestra cuántas personas hay por puesto.
    revalidatePath('/configuracion');
    return null;
  } catch (error) {
    if (error instanceof AccessDenied) return DENIED[error.reason];
    console.error('[personal] no se pudo guardar el cambio', error);
    return 'No se pudo guardar el cambio. Probá de nuevo.';
  }
}

export async function addStaffAction(name: string, positionId: string): Promise<string | null> {
  return run(addStaffInput, { name, positionId }, (access, input) =>
    addEmployee(getDb(), access, input),
  );
}

export async function setStaffPositionAction(
  employeeId: string,
  positionId: string,
): Promise<string | null> {
  return run(setStaffPositionInput, { employeeId, positionId }, (access, input) =>
    setEmployeePosition(getDb(), access, input),
  );
}

export async function setStaffActiveAction(
  employeeId: string,
  active: boolean,
): Promise<string | null> {
  return run(setStaffActiveInput, { employeeId, active }, (access, input) =>
    setEmployeeActive(getDb(), access, input),
  );
}
