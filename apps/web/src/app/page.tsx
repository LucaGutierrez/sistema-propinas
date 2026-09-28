import { LockIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import { DatabaseHome } from '@/components/home/database-home';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dashboard } from '@/components/week/dashboard';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN, ROLE_LABEL } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { getRestaurantSummary } from '@/server/restaurants/summary';

// La fuente de datos (demo o base) y la sesión se resuelven en cada pedido.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (!databaseEnabled()) return <Dashboard />;

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewStaff });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED') redirect('/login');
    // Sin restaurantes todavía (cuenta recién creada): a crear el primero.
    if (error.reason === 'NOT_FOUND') redirect('/crear-restaurante');
    return (
      <Card className="mx-auto mt-8 max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <LockIcon className="size-5" />
          </div>
          <CardTitle>No tenés acceso a esta sección</CardTitle>
          <CardDescription>Con tu rol solo podés ver tus propios sobres.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const summary = await getRestaurantSummary(getDb(), access.restaurantId);
  if (!summary) redirect('/crear-restaurante');
  return <DatabaseHome summary={summary} role={ROLE_LABEL[access.role]} />;
}
