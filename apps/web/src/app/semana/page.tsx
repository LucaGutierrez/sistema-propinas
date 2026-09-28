import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { databaseEnabled } from '@/server/context';
import { AccessGate } from '@/components/access/access-gate';
import { CurrentWeek } from '@/components/week/current-week';

export const metadata: Metadata = { title: 'Semana actual' };

export default function CurrentWeekPage() {
  // En modo base el reparto real está en /reparto (nunca datos ficticios de la demo).
  if (databaseEnabled()) redirect('/reparto');
  return (
    <AccessGate need="viewAll">
      <CurrentWeek />
    </AccessGate>
  );
}
