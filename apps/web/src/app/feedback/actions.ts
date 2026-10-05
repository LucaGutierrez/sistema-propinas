'use server';

/**
 * Acciones de comentarios. La identidad sale SIEMPRE de la sesión del pedido (Better Auth); del
 * navegador solo llegan los datos del comentario. Revisar (estado, borrar) lo vuelve a verificar
 * el servicio en cada llamada.
 */
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { feedbackIdInput, feedbackInput, feedbackStatusInput } from '@/server/feedback/schemas';
import {
  createFeedback,
  deleteFeedback,
  FeedbackForbidden,
  setFeedbackStatus,
} from '@/server/feedback/service';

export type FeedbackActionResult =
  { ok: true } | { ok: false; error: string; field?: 'category' | 'title' | 'description' };

const NO_DATABASE =
  'Los comentarios necesitan la base de datos, que no está activada en este servidor.';

export async function sendFeedbackAction(raw: unknown): Promise<FeedbackActionResult> {
  if (!databaseEnabled()) return { ok: false, error: NO_DATABASE };
  const parsed = feedbackInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      error: issue?.message ?? 'Revisá los datos.',
      ...(field === 'category' || field === 'title' || field === 'description' ? { field } : {}),
    };
  }
  try {
    const result = await createFeedback(getDb(), await getSessionUser(), parsed.data);
    if (!result.ok) return result;
    revalidatePath('/feedback/revisar');
    return { ok: true };
  } catch (error) {
    console.error('[feedback] no se pudo guardar un comentario', error);
    return { ok: false, error: 'No se pudo enviar. Probá de nuevo en un rato.' };
  }
}

async function review(task: () => Promise<{ ok: boolean; error?: string }>) {
  if (!databaseEnabled()) return { ok: false as const, error: NO_DATABASE };
  try {
    const result = await task();
    if (!result.ok) return { ok: false as const, error: result.error ?? 'No se pudo guardar.' };
    revalidatePath('/feedback/revisar');
    return { ok: true as const };
  } catch (error) {
    if (error instanceof FeedbackForbidden) return { ok: false as const, error: error.message };
    console.error('[feedback] no se pudo actualizar un comentario', error);
    return { ok: false as const, error: 'No se pudo guardar el cambio. Probá de nuevo.' };
  }
}

export async function setFeedbackStatusAction(id: string, status: string) {
  const parsed = feedbackStatusInput.safeParse({ id, status });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' };
  }
  return review(async () => setFeedbackStatus(getDb(), await getSessionUser(), parsed.data));
}

export async function deleteFeedbackAction(id: string) {
  const parsed = feedbackIdInput.safeParse({ id });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' };
  }
  return review(async () => deleteFeedback(getDb(), await getSessionUser(), parsed.data));
}
