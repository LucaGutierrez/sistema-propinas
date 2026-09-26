import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { RulesPage } from '@/components/rules/rules-page';

export const metadata: Metadata = { title: 'Reglas de cálculo' };

export default function RulesRoute() {
  return (
    <AccessGate need="viewAll">
      <RulesPage />
    </AccessGate>
  );
}
