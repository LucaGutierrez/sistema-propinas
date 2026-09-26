import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { WeekDetail } from '@/components/week/week-detail';

export const metadata: Metadata = { title: 'Semana' };

export default async function WeekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AccessGate need="viewAll">
      <WeekDetail weekId={id} />
    </AccessGate>
  );
}
