import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EnvelopesBoard } from '@/components/sobres/envelopes-board';
import { AccessDenied, isUuid, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { getEnvelopesView } from '@/server/envelopes/repository';

export const metadata: Metadata = { title: 'Sobres' };

export const dynamic = 'force-dynamic';

export default async function PeriodEnvelopesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseEnabled()) redirect(`/semanas/${encodeURIComponent(id)}`);

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewEnvelopes });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED') {
      redirect(`/login?next=${encodeURIComponent(`/sobres/${id}`)}`);
    }
    notFound();
  }
  if (!isUuid(id)) notFound();

  const view = await getEnvelopesView(getDb(), access, id);
  // Un reparto abierto todavía no tiene sobres; uno de otro restaurante no existe.
  if (!view) notFound();
  // SELF sin sobre en ese reparto: no revela nada del resto.
  if (view.ownOnly && view.envelopes.length === 0) notFound();
  return <EnvelopesBoard view={view} />;
}
