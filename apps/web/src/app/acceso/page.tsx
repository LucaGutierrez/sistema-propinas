import type { Metadata } from 'next';
import { NotAvailableYet } from '@/components/layout/not-available';
import { databaseEnabled } from '@/server/context';
import { AccessManager } from '@/components/access/access-manager';

export const metadata: Metadata = { title: 'Acceso' };

export default function AccessPage() {
  // Todavía es de la demo: en modo base, nunca datos ficticios.
  if (databaseEnabled()) return <NotAvailableYet title="Acceso" />;
  return <AccessManager />;
}
