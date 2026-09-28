import type { Metadata } from 'next';
import { NotAvailableYet } from '@/components/layout/not-available';
import { databaseEnabled } from '@/server/context';
import { MyEnvelopes } from '@/components/access/my-envelopes';

export const metadata: Metadata = { title: 'Mis sobres' };

export default function MyEnvelopesPage() {
  // Todavía es de la demo: en modo base, nunca datos ficticios.
  if (databaseEnabled()) return <NotAvailableYet title="Mis sobres" />;
  return <MyEnvelopes />;
}
