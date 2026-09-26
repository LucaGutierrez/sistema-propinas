import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { DistributionConfigPage } from '@/components/config/distribution-config-page';

export const metadata: Metadata = { title: 'Configuración de distribución' };

export default function DistributionConfigRoute() {
  return (
    <AccessGate need="viewAll">
      <DistributionConfigPage />
    </AccessGate>
  );
}
