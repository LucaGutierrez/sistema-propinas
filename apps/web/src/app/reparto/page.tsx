import { LockIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PeriodEditor } from '@/components/reparto/period-editor';
import { PeriodList } from '@/components/reparto/period-list';
import { StartPeriod } from '@/components/reparto/start-period';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { periodStartOf, todayInTimeZone } from '@/lib/dates';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN, roleAllowed } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { getOpenPeriodView, listPeriods } from '@/server/periods/repository';

export const metadata: Metadata = { title: 'Repartir propinas' };

// La sesión y los datos se resuelven en cada pedido.
export const dynamic = 'force-dynamic';

export default async function RepartoPage() {
  // En la demo, el reparto es "Semana actual".
  if (!databaseEnabled()) redirect('/semana');

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewPeriods });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED')
      redirect(`/login?next=${encodeURIComponent('/reparto')}`);
    if (error.reason === 'NOT_FOUND') redirect('/crear-restaurante');
    return (
      <Card className="mx-auto mt-8 max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <LockIcon className="size-5" />
          </div>
          <CardTitle>No tenés acceso a esta sección</CardTitle>
          <CardDescription>Tu rol no permite ver los repartos del local.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const db = getDb();
  const [view, periods, restaurant, activePeople] = await Promise.all([
    getOpenPeriodView(db, access),
    listPeriods(db, access.restaurantId, 8),
    db.restaurant.findUnique({
      where: { id: access.restaurantId },
      select: { timezone: true, currentPolicyVersion: { select: { periodStartWeekday: true } } },
    }),
    db.employee.count({
      where: { restaurantId: access.restaurantId, active: true, archivedAt: null },
    }),
  ]);

  if (view) return <PeriodEditor view={view} />;

  const today = todayInTimeZone(restaurant?.timezone ?? 'America/Argentina/Buenos_Aires');
  const currentStart = periodStartOf(
    today,
    restaurant?.currentPolicyVersion?.periodStartWeekday ?? 1,
  );
  return (
    <div className="space-y-8">
      <StartPeriod
        currentStart={currentStart}
        activePeople={activePeople}
        canEdit={roleAllowed(access.role, CAN.editPeriod)}
      />
      <div className="mx-auto max-w-3xl">
        <PeriodList periods={periods} />
      </div>
    </div>
  );
}
