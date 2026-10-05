import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { SessionUser } from '@/server/auth/session';
import { feedbackInput } from '@/server/feedback/schemas';
import {
  createFeedback,
  deleteFeedback,
  FeedbackForbidden,
  listFeedback,
  parseReviewers,
  setFeedbackStatus,
} from '@/server/feedback/service';

/*
 * Comentarios de testers contra PostgreSQL real: envío con y sin cuenta, revisión solo para los
 * revisores, cambio de estado, borrado y las restricciones de la tabla.
 */

let db: PrismaClient;

beforeAll(() => {
  db = new PrismaClient({ datasourceUrl: inject('pgUrl') });
});
afterAll(async () => {
  await db.$disconnect();
});

async function user(name: string): Promise<SessionUser> {
  const email = `${name.toLowerCase()}-${randomUUID()}@example.invalid`;
  const row = await db.user.create({ data: { email, name } });
  return { id: row.id, email, name };
}

const send = (who: SessionUser | null, raw: Record<string, unknown>) =>
  createFeedback(db, who, feedbackInput.parse(raw));

describe('comentarios de testers', () => {
  it('con sesión queda a nombre del usuario; sin sesión, anónimo; la revisión los lista', async () => {
    const reviewer = await user('Revisor');
    const reviewers = parseReviewers(reviewer.email);
    const tester = await user('Tester');
    const bug = await send(tester, {
      category: 'BUG',
      title: 'No cierra',
      description: 'Al cerrar el reparto aparece un error.',
      page: '/reparto',
    });
    const anon = await send(null, {
      category: 'SUGGESTION',
      description: 'Estaría bueno exportar a Excel.',
    });
    if (!bug.ok || !anon.ok) throw new Error('no se guardó');

    const list = await listFeedback(
      db,
      reviewer,
      { category: null, status: null, page: 1 },
      reviewers,
    );
    const mine = list.items.filter((i) => i.id === bug.value.id || i.id === anon.value.id);
    // Del más reciente al más antiguo.
    expect(mine.map((i) => [i.category, i.authorName, i.status, i.page])).toEqual([
      ['SUGGESTION', null, 'NEW', null],
      ['BUG', 'Tester', 'NEW', '/reparto'],
    ]);
    const onlyBugs = await listFeedback(
      db,
      reviewer,
      { category: 'BUG', status: null, page: 1 },
      reviewers,
    );
    expect(onlyBugs.items.every((i) => i.category === 'BUG')).toBe(true);
    expect(onlyBugs.counts.category.SUGGESTION).toBeGreaterThanOrEqual(1);
  });

  it('el revisor cambia el estado (queda quién y cuándo) y borra', async () => {
    const reviewer = await user('Revisor');
    const reviewers = parseReviewers(reviewer.email);
    const sent = await send(null, {
      category: 'COMMENT',
      description: 'Muy fácil de usar, gracias.',
    });
    if (!sent.ok || !sent.value.id) throw new Error('no se guardó');
    const id = sent.value.id;

    const changed = await setFeedbackStatus(db, reviewer, { id, status: 'IN_REVIEW' }, reviewers);
    expect(changed).toEqual({ ok: true, value: { status: 'IN_REVIEW', changed: true } });
    const row = await db.feedback.findUniqueOrThrow({ where: { id } });
    expect(row.statusChangedById).toBe(reviewer.id);
    expect(row.statusChangedAt).not.toBeNull();

    expect(await deleteFeedback(db, reviewer, { id }, reviewers)).toEqual({
      ok: true,
      value: { id },
    });
    expect(await db.feedback.findUnique({ where: { id } })).toBeNull();
    expect(await deleteFeedback(db, reviewer, { id }, reviewers)).toEqual({
      ok: false,
      error: 'Ese comentario ya no existe.',
    });
  });

  it('quien no es revisor (ni sin sesión) no lista, no cambia ni borra', async () => {
    const reviewer = await user('Revisor');
    const reviewers = parseReviewers(reviewer.email);
    const owner = await user('Dueño');
    const sent = await send(owner, { category: 'BUG', description: 'Algo no anda bien acá.' });
    if (!sent.ok || !sent.value.id) throw new Error('no se guardó');
    const id = sent.value.id;
    for (const who of [owner, null]) {
      await expect(
        listFeedback(db, who, { category: null, status: null, page: 1 }, reviewers),
      ).rejects.toBeInstanceOf(FeedbackForbidden);
      await expect(
        setFeedbackStatus(db, who, { id, status: 'RESOLVED' }, reviewers),
      ).rejects.toBeInstanceOf(FeedbackForbidden);
      await expect(deleteFeedback(db, who, { id }, reviewers)).rejects.toBeInstanceOf(
        FeedbackForbidden,
      );
    }
    expect((await db.feedback.findUniqueOrThrow({ where: { id } })).status).toBe('NEW');
  });

  it('el campo trampa (robots) no guarda nada; la base exige los largos', async () => {
    const before = await db.feedback.count();
    const bot = await send(null, {
      category: 'COMMENT',
      description: 'Comprá seguidores baratos.',
      website: 'http://spam.example',
    });
    expect(bot).toEqual({ ok: true, value: { id: null } });
    expect(await db.feedback.count()).toBe(before);

    await expect(
      db.feedback.create({ data: { category: 'BUG', description: 'corto' } }),
    ).rejects.toThrow(/ck_feedback_description/);
    await expect(
      db.feedback.create({
        data: { category: 'BUG', description: 'Descripción válida', page: 'https://x.com' },
      }),
    ).rejects.toThrow(/ck_feedback_page/);
  });
});
