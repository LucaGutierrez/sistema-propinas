import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { HistoryListView } from '@/components/history/history-list';
import { History } from '@/components/week/history';
import { parseHistoryFilters } from '@/lib/history/filters';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { listHistory } from '@/server/history/repository';

export const metadata: Metadata = { title: 'Historial' };

export const dynamic = 'force-dynamic';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!databaseEnabled()) {
    return (
      <AccessGate need="viewAll">
        <History />
      </AccessGate>
    );
  }

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewHistory });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED') {
      redirect(`/login?next=${encodeURIComponent('/historial')}`);
    }
    redirect('/crear-restaurante');
  }

  const filters = parseHistoryFilters(await searchParams);
  const list = await listHistory(getDb(), access, filters);
  return <HistoryListView list={list} filters={filters} />;
}
