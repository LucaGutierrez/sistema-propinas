import type { Metadata } from 'next';
import { MyEnvelopes } from '@/components/access/my-envelopes';

export const metadata: Metadata = { title: 'Mis sobres' };

export default function MyEnvelopesPage() {
  return <MyEnvelopes />;
}
