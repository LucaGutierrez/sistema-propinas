'use server';

/**
 * Acciones de sobres contra la base. En CADA llamada `requireAccess` vuelve a resolver el acceso
 * en el servidor; del navegador llegan solo ids y textos (validados con Zod). El servicio vuelve a
 * comprobar el rol, el restaurante y la política del período, y bloquea las filas que cambia.
 */
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN, type Role } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import {
  deliverEnvelopeInput,
  prepareEnvelopesInput,
  revertDeliveryInput,
  undoPreparationInput,
} from '@/server/envelopes/schemas';
import {
  deliverEnvelope,
  prepareEnvelopes,
  revertDelivery,
  undoPreparation,
} from '@/server/envelopes/service';
import type { ServiceResult } from '@/server/policy/service';
import { firstIssue } from '@/server/staff/schemas';

export type EnvelopeActionResult = { ok: true; message: string } | { ok: false; error: string };

const DENIED: Record<AccessDenied['reason'], string> = {
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a iniciar sesión.',
  NOT_FOUND: 'No se encontró el restaurante.',
  FORBIDDEN: 'Tu rol no permite hacer esto con los sobres.',
};

async function run<S extends z.ZodType, T>(
  roles: readonly Role[],
  schema: S,
  raw: unknown,
  change: (access: AccessContext, input: z.infer<S>) => Promise<ServiceResult<T>>,
  message: (value: T) => string,
): Promise<EnvelopeActionResult> {
  if (!databaseEnabled()) return { ok: false, error: 'La base de datos no está activada.' };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const access = await requireAccess({ roles });
    const result = await change(access, parsed.data);
    if (!result.ok) return result;
    revalidatePath('/sobres', 'layout');
    return { ok: true, message: message(result.value) };
  } catch (error) {
    if (error instanceof AccessDenied) return { ok: false, error: DENIED[error.reason] };
    console.error('[sobres] no se pudo guardar', error);
    return { ok: false, error: 'No se pudo guardar. Revisá tu conexión y probá de nuevo.' };
  }
}

export async function prepareEnvelopesAction(
  settlementId: string,
  paymentIds?: string[],
): Promise<EnvelopeActionResult> {
  return run(
    CAN.handleEnvelopes,
    prepareEnvelopesInput,
    { settlementId, paymentIds },
    (access, input) => prepareEnvelopes(getDb(), access, input),
    ({ prepared }) =>
      prepared === 0
        ? 'No había sobres pendientes para preparar.'
        : prepared === 1
          ? 'Sobre preparado.'
          : `${prepared} sobres preparados.`,
  );
}

export async function undoPreparationAction(
  paymentId: string,
  reason: string,
): Promise<EnvelopeActionResult> {
  return run(
    CAN.handleEnvelopes,
    undoPreparationInput,
    { paymentId, reason },
    (access, input) => undoPreparation(getDb(), access, input),
    () => 'Se deshizo la preparación.',
  );
}

export async function deliverEnvelopeAction(
  paymentId: string,
  note = '',
): Promise<EnvelopeActionResult> {
  return run(
    CAN.handleEnvelopes,
    deliverEnvelopeInput,
    { paymentId, note },
    (access, input) => deliverEnvelope(getDb(), access, input),
    () => 'Sobre entregado.',
  );
}

export async function revertDeliveryAction(
  paymentId: string,
  reason: string,
): Promise<EnvelopeActionResult> {
  return run(
    CAN.revertDelivery,
    revertDeliveryInput,
    { paymentId, reason },
    (access, input) => revertDelivery(getDb(), access, input),
    () => 'Se revirtió la entrega: el sobre volvió a Preparado.',
  );
}
