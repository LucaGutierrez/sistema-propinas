import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { SessionBar } from '@/components/auth/session-bar';
import { DatabaseDistributionConfig } from '@/components/config/database-distribution-config';
import { DemoDistributionConfig } from '@/components/config/demo-distribution-config';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DistributionConfigView } from '@/lib/policy/view';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN, ROLE_LABEL } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { loadDistributionConfig } from '@/server/policy/commands';

export const metadata: Metadata = { title: 'Configuración de distribución' };

// La fuente de datos (demo o base) y la sesión se resuelven en cada pedido.
export const dynamic = 'force-dynamic';

const LOGIN = `/login?next=${encodeURIComponent('/configuracion')}`;

type Loaded =
  | { kind: 'ok'; access: AccessContext; view: DistributionConfigView | null }
  | { kind: 'denied'; error: AccessDenied }
  | { kind: 'error' };

async function load(): Promise<Loaded> {
  try {
    const access = await requireAccess({ roles: CAN.viewDistributionConfig });
    return { kind: 'ok', access, view: await loadDistributionConfig(getDb(), access) };
  } catch (error) {
    if (error instanceof AccessDenied) return { kind: 'denied', error };
    console.error('[configuracion] no se pudo leer la política', error);
    return { kind: 'error' };
  }
}

export default async function DistributionConfigRoute() {
  if (!databaseEnabled()) {
    return (
      <AccessGate need="viewAll">
        <DemoDistributionConfig />
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
        message={
          reason === 'FORBIDDEN'
            ? 'Tu rol no permite ver la configuración de distribución.'
            : message
        }
      />
    );
  }
  if (loaded.kind === 'error' || !loaded.view) {
    return (
      <Problem
        title="No se puede mostrar la configuración"
        message={
          loaded.kind === 'error'
            ? 'No se pudo leer la configuración desde la base de datos.'
            : 'El restaurante todavía no tiene política de distribución.'
        }
      />
    );
  }

  const { access, view } = loaded;
  return (
    <>
      <SessionBar
        userName={access.userName}
        email={access.userEmail}
        role={ROLE_LABEL[access.role]}
        restaurantName={access.restaurantName}
      />
      <DatabaseDistributionConfig view={view} />
    </>
  );
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
