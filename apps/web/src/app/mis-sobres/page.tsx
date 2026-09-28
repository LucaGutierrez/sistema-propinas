import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { databaseEnabled } from '@/server/context';
import { MyEnvelopes } from '@/components/access/my-envelopes';

export const metadata: Metadata = { title: 'Mis sobres' };

export default function MyEnvelopesPage() {
  // En modo base, /sobres ya muestra solo lo propio para el rol SELF (nunca datos de la demo).
  if (databaseEnabled()) redirect('/sobres');
  return <MyEnvelopes />;
}
