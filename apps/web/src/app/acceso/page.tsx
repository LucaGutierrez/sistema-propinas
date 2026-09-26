import type { Metadata } from 'next';
import { AccessManager } from '@/components/access/access-manager';

export const metadata: Metadata = { title: 'Acceso' };

export default function AccessPage() {
  return <AccessManager />;
}
