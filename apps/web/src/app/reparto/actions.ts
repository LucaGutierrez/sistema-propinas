'use server';

/**
 * Acciones del reparto contra la base de datos. En CADA llamada `requireAccess` vuelve a resolver
 * el acceso en el servidor (sesión, restaurante activo verificado contra sus membresías y rol). Del
 * navegador llegan solo los datos del cambio (validados con Zod); nunca el restaurante, el usuario
 * ni el rol.
 *
 * Rendimiento: guardar propina u horas NO vuelve a renderizar la página (la pantalla ya muestra lo
 * que el usuario escribió y calcula en vivo); solo empezar, registrar adelantos y cerrar refrescan.
 */
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN, type Role } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import {
  addAdvanceInput,
  closePeriodInput,
  redoPeriodInput,
  setHoursInput,
  setTipsInput,
  startPeriodInput,
  voidAdvanceInput,
  voidPeriodInput,
} from '@/server/periods/schemas';
import {
  addPeriodAdvance,
  closePeriod,
  redoPeriod,
  setPeriodHours,
  setPeriodTips,
  startPeriod,
  voidPeriod,
  voidPeriodAdvance,
} from '@/server/periods/service';
import type { ServiceResult } from '@/server/policy/service';
import { firstIssue } from '@/server/staff/schemas';

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const DENIED: Record<AccessDenied['reason'], string> = {
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a iniciar sesión.',
  NOT_FOUND: 'No se encontró el restaurante.',
  FORBIDDEN: 'Tu rol no permite hacer esto en el reparto.',
};

async function run<S extends z.ZodType, T>(
  roles: readonly Role[],
  schema: S,
  raw: unknown,
  change: (access: AccessContext, input: z.infer<S>) => Promise<ServiceResult<T>>,
  after?: () => void,
): Promise<ActionResult<T>> {
  if (!databaseEnabled()) return { ok: false, error: 'La base de datos no está activada.' };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const access = await requireAccess({ roles });
    const result = await change(access, parsed.data);
    if (!result.ok) return result;
    after?.();
    return result;
  } catch (error) {
    if (error instanceof AccessDenied) return { ok: false, error: DENIED[error.reason] };
    console.error('[reparto] no se pudo guardar', error);
    return { ok: false, error: 'No se pudo guardar. Revisá tu conexión y probá de nuevo.' };
  }
}

const refresh = () => {
  revalidatePath('/reparto');
  revalidatePath('/');
};

export async function startPeriodAction(date?: string): Promise<ActionResult<string>> {
  const result = await run(
    CAN.editPeriod,
    startPeriodInput,
    { date },
    (access, input) => startPeriod(getDb(), access, input),
    refresh,
  );
  return result.ok ? { ok: true, value: result.value.settlementId } : result;
}

export async function setTotalTipsAction(
  settlementId: string,
  total: string,
): Promise<ActionResult> {
  const result = await run(
    CAN.editPeriod,
    setTipsInput,
    { mode: 'total', settlementId, total },
    (access, input) => setPeriodTips(getDb(), access, input),
  );
  return result.ok ? { ok: true, value: null } : result;
}

export async function setDailyTipsAction(
  settlementId: string,
  days: { date: string; amount: string }[],
): Promise<ActionResult> {
  const result = await run(
    CAN.editPeriod,
    setTipsInput,
    { mode: 'daily', settlementId, days },
    (access, input) => setPeriodTips(getDb(), access, input),
  );
  return result.ok ? { ok: true, value: null } : result;
}

export async function setHoursAction(
  settlementId: string,
  entries: { employeeId: string; hours: string | null }[],
): Promise<ActionResult> {
  const result = await run(
    CAN.editPeriod,
    setHoursInput,
    { settlementId, entries },
    (access, input) => setPeriodHours(getDb(), access, input),
  );
  return result.ok ? { ok: true, value: null } : result;
}

export async function addAdvanceAction(input: {
  settlementId: string;
  employeeId: string;
  date: string;
  amount: string;
  note: string;
}): Promise<ActionResult> {
  const result = await run(
    CAN.editPeriod,
    addAdvanceInput,
    input,
    (access, data) => addPeriodAdvance(getDb(), access, data),
    refresh,
  );
  return result.ok ? { ok: true, value: null } : result;
}

export async function voidAdvanceAction(advanceId: string, reason: string): Promise<ActionResult> {
  const result = await run(
    CAN.editPeriod,
    voidAdvanceInput,
    { advanceId, reason },
    (access, data) => voidPeriodAdvance(getDb(), access, data),
    refresh,
  );
  return result.ok ? { ok: true, value: null } : result;
}

const refreshAll = () => {
  revalidatePath('/reparto', 'layout');
  revalidatePath('/historial', 'layout');
  revalidatePath('/sobres', 'layout');
  revalidatePath('/');
};

/** Anular un reparto cerrado (motivo obligatorio). Solo Dueño/Encargado. */
export async function voidPeriodAction(
  settlementId: string,
  reason: string,
): Promise<ActionResult<string>> {
  const result = await run(
    CAN.voidPeriod,
    voidPeriodInput,
    { settlementId, reason },
    (access, data) => voidPeriod(getDb(), access, data),
    refreshAll,
  );
  return result.ok ? { ok: true, value: result.value.settlementId } : result;
}

/** Rehacer un reparto anulado: abre el reparto nuevo de la misma semana. Solo Dueño/Encargado. */
export async function redoPeriodAction(settlementId: string): Promise<ActionResult<string>> {
  const result = await run(
    CAN.voidPeriod,
    redoPeriodInput,
    { settlementId },
    (access, data) => redoPeriod(getDb(), access, data),
    refreshAll,
  );
  return result.ok ? { ok: true, value: result.value.settlementId } : result;
}

export async function closePeriodAction(settlementId: string): Promise<ActionResult<string>> {
  const result = await run(
    CAN.closePeriod,
    closePeriodInput,
    { settlementId },
    (access, data) => closePeriod(getDb(), access, data),
    refresh,
  );
  return result.ok ? { ok: true, value: result.value.settlementId } : result;
}
