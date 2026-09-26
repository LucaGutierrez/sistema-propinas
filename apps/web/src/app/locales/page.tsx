import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { VenuesManager } from '@/components/venues/venues-manager';

export const metadata: Metadata = { title: 'Mis locales' };

export default function VenuesPage() {
  return (
    <AccessGate need="owner">
      <VenuesManager />
    </AccessGate>
  );
}
