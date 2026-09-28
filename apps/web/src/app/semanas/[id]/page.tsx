import type { Metadata } from 'next';
import { NotAvailableYet } from '@/components/layout/not-available';
import { databaseEnabled } from '@/server/context';
import { AccessGate } from '@/components/access/access-gate';
import { WeekDetail } from '@/components/week/week-detail';

export const metadata: Metadata = { title: 'Semana' };

export default async function WeekPage({ params }: { params: Promise<{ id: string }> }) {
  // Todavía es de la demo: en modo base, nunca datos ficticios.
  if (databaseEnabled()) return <NotAvailableYet title="Semana" />;
  const { id } = await params;
  return (
    <AccessGate need="viewAll">
      <WeekDetail weekId={id} />
    </AccessGate>
  );
}
