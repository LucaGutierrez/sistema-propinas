import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { CurrentWeek } from '@/components/week/current-week';

export const metadata: Metadata = { title: 'Semana actual' };

export default function CurrentWeekPage() {
  return (
    <AccessGate need="viewAll">
      <CurrentWeek />
    </AccessGate>
  );
}
