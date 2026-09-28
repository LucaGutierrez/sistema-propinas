import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { databaseEnabled } from '@/server/context';
import { AccessGate } from '@/components/access/access-gate';
import { VenuesManager } from '@/components/venues/venues-manager';

export const metadata: Metadata = { title: 'Mis locales' };

export default function VenuesPage() {
  // En modo base, los restaurantes del usuario (reales) se ven y se eligen en Mi sesión.
  if (databaseEnabled()) redirect('/cuenta');
  return (
    <AccessGate need="owner">
      <VenuesManager />
    </AccessGate>
  );
}
