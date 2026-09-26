import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { StaffManager } from '@/components/staff/staff-manager';

export const metadata: Metadata = { title: 'Personal' };

export default function PersonalPage() {
  return (
    <AccessGate need="viewAll">
      <StaffManager />
    </AccessGate>
  );
}
