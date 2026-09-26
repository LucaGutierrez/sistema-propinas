import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { History } from '@/components/week/history';

export const metadata: Metadata = { title: 'Historial' };

export default function HistoryPage() {
  return (
    <AccessGate need="viewAll">
      <History />
    </AccessGate>
  );
}
