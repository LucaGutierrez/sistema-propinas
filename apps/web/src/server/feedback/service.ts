/**
 * Comentarios de testers sobre GUTIP (no son de un restaurante).
 *
 * - ENVIAR: cualquiera, con o sin cuenta. Con sesión se asocia al usuario (la identidad sale de la
 *   sesión, nunca del navegador); sin sesión queda anónimo. No se guarda IP ni navegador.
 * - REVISAR (ver, cambiar estado, borrar): solo los emails de `GUTIP_FEEDBACK_REVIEWERS` (lista
 *   separada por comas). Los roles de restaurante no alcanzan: el dueño de un local no ve los
 *   comentarios de otros locales. Sin la variable, nadie revisa.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PAGE_SIZE,
  FEEDBACK_STATUSES,
  type FeedbackFilters,
  type FeedbackList,
  type FeedbackStatus,
} from '@/lib/feedback/view';
import type { SessionUser } from '../auth/session';
import type { ServiceResult } from '../policy/service';
import type { FeedbackInput } from './schemas';

/** Emails revisores (en minúsculas) de una lista "a@x.com, b@y.com". */
export function parseReviewers(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes('@')),
  );
}

/** ¿Este usuario revisa los comentarios? (lee la variable en cada pedido). */
export function isFeedbackReviewer(
  user: SessionUser | null,
  reviewers = parseReviewers(process.env.GUTIP_FEEDBACK_REVIEWERS),
): boolean {
  return user !== null && reviewers.has(user.email.toLowerCase());
}

export class FeedbackForbidden extends Error {}

function assertReviewer(user: SessionUser | null, reviewers?: Set<string>): SessionUser {
  if (!user || !isFeedbackReviewer(user, reviewers)) {
    throw new FeedbackForbidden('Solo el equipo de GUTIP revisa los comentarios.');
  }
  return user;
}

const fail = <T>(error: string): ServiceResult<T> => ({ ok: false, error });

/** Guarda un comentario. `user` = sesión del pedido (null: sin cuenta). */
export async function createFeedback(
  db: PrismaClient,
  user: SessionUser | null,
  input: FeedbackInput,
): Promise<ServiceResult<{ id: string | null }>> {
  // Robot (completó el campo trampa): se responde como si nada para no darle pistas.
  if (input.website && input.website.trim() !== '') return { ok: true, value: { id: null } };
  const created = await db.feedback.create({
    data: {
      category: input.category,
      title: input.title,
      description: input.description,
      page: input.page,
      userId: user?.id ?? null,
    },
    select: { id: true },
  });
  return { ok: true, value: { id: created.id } };
}

export async function setFeedbackStatus(
  db: PrismaClient,
  user: SessionUser | null,
  input: { id: string; status: FeedbackStatus },
  reviewers?: Set<string>,
): Promise<ServiceResult<{ status: FeedbackStatus; changed: boolean }>> {
  const reviewer = assertReviewer(user, reviewers);
  const current = await db.feedback.findUnique({
    where: { id: input.id },
    select: { status: true },
  });
  if (!current) return fail('Ese comentario ya no existe.');
  if (current.status === input.status) {
    return { ok: true, value: { status: input.status, changed: false } };
  }
  await db.feedback.update({
    where: { id: input.id },
    data: { status: input.status, statusChangedAt: new Date(), statusChangedById: reviewer.id },
  });
  return { ok: true, value: { status: input.status, changed: true } };
}

/** Borra un comentario (la pantalla pide confirmación antes). */
export async function deleteFeedback(
  db: PrismaClient,
  user: SessionUser | null,
  input: { id: string },
  reviewers?: Set<string>,
): Promise<ServiceResult<{ id: string }>> {
  assertReviewer(user, reviewers);
  const deleted = await db.feedback.deleteMany({ where: { id: input.id } });
  if (deleted.count === 0) return fail('Ese comentario ya no existe.');
  return { ok: true, value: { id: input.id } };
}

/** Comentarios del más nuevo al más viejo, con filtros y contadores. */
export async function listFeedback(
  db: PrismaClient,
  user: SessionUser | null,
  filters: FeedbackFilters,
  reviewers?: Set<string>,
): Promise<FeedbackList> {
  assertReviewer(user, reviewers);
  const where: Prisma.FeedbackWhereInput = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const [rows, byCategory, byStatus] = await Promise.all([
    db.feedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * FEEDBACK_PAGE_SIZE,
      take: FEEDBACK_PAGE_SIZE + 1,
      select: {
        id: true,
        category: true,
        title: true,
        description: true,
        page: true,
        status: true,
        createdAt: true,
        statusChangedAt: true,
        user: { select: { name: true } },
        statusChangedBy: { select: { name: true } },
      },
    }),
    db.feedback.groupBy({ by: ['category'], _count: { _all: true } }),
    db.feedback.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const category = Object.fromEntries(FEEDBACK_CATEGORIES.map((c) => [c, 0])) as Record<
    (typeof FEEDBACK_CATEGORIES)[number],
    number
  >;
  for (const g of byCategory) category[g.category] = g._count._all;
  const status = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<
    FeedbackStatus,
    number
  >;
  for (const g of byStatus) status[g.status] = g._count._all;
  return {
    hasMore: rows.length > FEEDBACK_PAGE_SIZE,
    counts: { category, status },
    items: rows.slice(0, FEEDBACK_PAGE_SIZE).map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      description: r.description,
      page: r.page,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      authorName: r.user?.name ?? null,
      statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
      statusChangedBy: r.statusChangedBy?.name ?? null,
    })),
  };
}
