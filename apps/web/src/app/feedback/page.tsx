import { MessagesSquareIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FeedbackForm } from '@/components/feedback/feedback-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeFeedbackPage } from '@/lib/feedback/view';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { isFeedbackReviewer } from '@/server/feedback/service';

export const metadata: Metadata = { title: 'Enviar comentarios' };
export const dynamic = 'force-dynamic';

/**
 * "Enviar comentarios": pública (no exige cuenta). Con sesión, el comentario queda a nombre del
 * usuario. `?desde=/reparto` registra desde qué pantalla se envió.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string | string[] }>;
}) {
  const raw = (await searchParams).desde;
  const fromPage = safeFeedbackPage(Array.isArray(raw) ? raw[0] : raw);
  const enabled = databaseEnabled();
  const user = enabled ? await getSessionUser() : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          <MessagesSquareIcon className="size-7 text-primary" />
          Enviar comentarios
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ¿Estás probando GUTIP? Contanos si algo falla, qué mejorarías o lo que quieras decirnos.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tu comentario</CardTitle>
          <CardDescription>
            Lo lee el equipo de GUTIP. Cuanto más concreto, mejor: qué pantalla, qué hiciste y qué
            pasó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enabled ? (
            <FeedbackForm signedInAs={user?.name ?? null} fromPage={fromPage} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Este servidor usa la demo del navegador, sin base de datos: los comentarios todavía no
              se pueden guardar acá.
            </p>
          )}
        </CardContent>
      </Card>
      {isFeedbackReviewer(user) ? (
        <p className="mt-4 text-sm">
          <Link href="/feedback/revisar" className="font-medium text-primary hover:underline">
            Ver los comentarios recibidos
          </Link>
        </p>
      ) : null}
    </div>
  );
}
