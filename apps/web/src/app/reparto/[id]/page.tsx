import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ClosedPeriod } from '@/components/reparto/closed-period';
import { AccessDenied, isUuid, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { getClosedPeriodView } from '@/server/periods/repository';

export const metadata: Metadata = { title: 'Reparto' };

export const dynamic = 'force-dynamic';

export default async function ClosedPeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cerrado?: string }>;
}) {
  const { id } = await params;
  if (!databaseEnabled()) redirect(`/semanas/${encodeURIComponent(id)}`);

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewPeriods });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED') {
      redirect(`/login?next=${encodeURIComponent(`/reparto/${id}`)}`);
    }
    notFound();
  }
  if (!isUuid(id)) notFound();

  const view = await getClosedPeriodView(getDb(), access.restaurantId, id);
  // Un reparto abierto se edita en /reparto; uno de otro restaurante no existe.
  if (!view) {
    const open = await getDb().weeklySettlement.findFirst({
      where: { id, restaurantId: access.restaurantId, status: 'OPEN' },
      select: { id: true },
    });
    if (open) redirect('/reparto');
    notFound();
  }
  const { cerrado } = await searchParams;
  return <ClosedPeriod view={view} justClosed={cerrado === '1'} />;
}
