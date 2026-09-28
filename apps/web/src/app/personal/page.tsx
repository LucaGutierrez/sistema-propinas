import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { DatabaseStaffManager } from '@/components/staff/database-staff-manager';
import { DemoStaffManager } from '@/components/staff/demo-staff-manager';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StaffView } from '@/lib/staff/view';
import { AccessDenied } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN, roleAllowed } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { getStaffView } from '@/server/staff/repository';

export const metadata: Metadata = { title: 'Personal' };

// La fuente de datos (demo o base) y la sesión se resuelven en cada pedido.
export const dynamic = 'force-dynamic';

const LOGIN = `/login?next=${encodeURIComponent('/personal')}`;

type Loaded =
  | { kind: 'ok'; view: StaffView | null }
  | { kind: 'denied'; error: AccessDenied }
  | { kind: 'error' };

async function load(): Promise<Loaded> {
  try {
    const access = await requireAccess({ roles: CAN.viewStaff });
    const view = await getStaffView(getDb(), {
      restaurantId: access.restaurantId,
      canEdit: roleAllowed(access.role, CAN.manageStaff),
    });
    return { kind: 'ok', view };
  } catch (error) {
    if (error instanceof AccessDenied) return { kind: 'denied', error };
    console.error('[personal] no se pudo leer el personal', error);
    return { kind: 'error' };
  }
}

export default async function PersonalPage() {
  if (!databaseEnabled()) {
    return (
      <AccessGate need="viewAll">
        <DemoStaffManager />
      </AccessGate>
    );
  }

  const loaded = await load();
  if (loaded.kind === 'denied') {
    const { reason, message } = loaded.error;
    if (reason === 'UNAUTHENTICATED') redirect(LOGIN);
    // Restaurante activo: NOT_FOUND = el usuario no es miembro de ningún restaurante.
    return (
      <Problem
        icon="lock"
        title={reason === 'FORBIDDEN' ? 'No tenés acceso a esta sección' : 'Sin restaurantes'}
        message={reason === 'FORBIDDEN' ? 'Con tu rol solo podés ver tus propios sobres.' : message}
      />
    );
  }
  if (loaded.kind === 'error' || !loaded.view) {
    return (
      <Problem
        title="No se puede mostrar el personal"
        message={
          loaded.kind === 'error'
            ? 'No se pudo leer el personal desde la base de datos.'
            : 'El restaurante todavía no tiene política de distribución.'
        }
      />
    );
  }
  return <DatabaseStaffManager view={loaded.view} />;
}

function Problem({
  title,
  message,
  icon = 'alert',
}: {
  title: string;
  message: string;
  icon?: 'alert' | 'lock';
}) {
  const Icon = icon === 'lock' ? LockIcon : AlertTriangleIcon;
  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}
