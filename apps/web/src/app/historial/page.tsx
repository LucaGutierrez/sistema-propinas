import type { Metadata } from 'next';
import { NotAvailableYet } from '@/components/layout/not-available';
import { databaseEnabled } from '@/server/context';
import { AccessGate } from '@/components/access/access-gate';
import { History } from '@/components/week/history';

export const metadata: Metadata = { title: 'Historial' };

export default function HistoryPage() {
  // Todavía es de la demo: en modo base, nunca datos ficticios.
  if (databaseEnabled()) return <NotAvailableYet title="Historial" />;
  return (
    <AccessGate need="viewAll">
      <History />
    </AccessGate>
  );
}
