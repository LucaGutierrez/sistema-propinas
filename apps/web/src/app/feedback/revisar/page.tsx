import { LockIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FeedbackReview } from '@/components/feedback/feedback-review';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { parseFeedbackFilters } from '@/lib/feedback/view';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { isFeedbackReviewer, listFeedback } from '@/server/feedback/service';

export const metadata: Metadata = { title: 'Comentarios recibidos' };
export const dynamic = 'force-dynamic';

/** "Comentarios recibidos": solo los emails de GUTIP_FEEDBACK_REVIEWERS. */
export default async function FeedbackReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!databaseEnabled()) redirect('/feedback');
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/feedback/revisar')}`);
  if (!isFeedbackReviewer(user)) {
    return (
      <Card className="mx-auto mt-8 max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <LockIcon className="size-5" />
          </div>
          <CardTitle>No tenés acceso a esta sección</CardTitle>
          <CardDescription>Los comentarios los revisa el equipo de GUTIP.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const filters = parseFeedbackFilters(await searchParams);
  const list = await listFeedback(getDb(), user, filters);
  return <FeedbackReview list={list} filters={filters} />;
}
