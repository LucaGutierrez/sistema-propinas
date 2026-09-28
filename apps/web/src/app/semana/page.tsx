import type { Metadata } from 'next';
import { NotAvailableYet } from '@/components/layout/not-available';
import { databaseEnabled } from '@/server/context';
import { AccessGate } from '@/components/access/access-gate';
import { CurrentWeek } from '@/components/week/current-week';

export const metadata: Metadata = { title: 'Semana actual' };

export default function CurrentWeekPage() {
  // Todavía es de la demo: en modo base, nunca datos ficticios.
  if (databaseEnabled()) return <NotAvailableYet title="Semana actual" />;
  return (
    <AccessGate need="viewAll">
      <CurrentWeek />
    </AccessGate>
  );
}
