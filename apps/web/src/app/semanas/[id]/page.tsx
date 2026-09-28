import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { databaseEnabled } from '@/server/context';
import { AccessGate } from '@/components/access/access-gate';
import { WeekDetail } from '@/components/week/week-detail';

export const metadata: Metadata = { title: 'Semana' };

export default async function WeekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // En modo base los repartos reales están en /reparto/[id] (nunca datos ficticios de la demo).
  if (databaseEnabled()) redirect(`/reparto/${encodeURIComponent(id)}`);
  return (
    <AccessGate need="viewAll">
      <WeekDetail weekId={id} />
    </AccessGate>
  );
}
