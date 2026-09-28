import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HistoryDetailView } from '@/components/history/history-detail';
import { AccessDenied, isUuid, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { getHistoryDetail } from '@/server/history/repository';

export const metadata: Metadata = { title: 'Historial' };

export const dynamic = 'force-dynamic';

export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseEnabled()) redirect(`/semanas/${encodeURIComponent(id)}`);

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewHistory });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED') {
      redirect(`/login?next=${encodeURIComponent(`/historial/${id}`)}`);
    }
    notFound();
  }
  if (!isUuid(id)) notFound();

  const detail = await getHistoryDetail(getDb(), access, id);
  // Abierto, inexistente o de otro restaurante: no existe para el historial.
  if (!detail) notFound();
  // SELF sin participación en ese reparto: no se revela nada.
  if (detail.ownOnly && detail.people.length === 0) notFound();
  return <HistoryDetailView detail={detail} />;
}
