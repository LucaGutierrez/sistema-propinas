import { AlertTriangleIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { DatabaseDistributionConfig } from '@/components/config/database-distribution-config';
import { DemoDistributionConfig } from '@/components/config/demo-distribution-config';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DistributionConfigView } from '@/lib/policy/view';
import { AccessError, configuredOperator, databaseEnabled, resolveAccess } from '@/server/context';
import { getDb } from '@/server/db';
import { getDistributionConfigView } from '@/server/policy/repository';

export const metadata: Metadata = { title: 'Configuración de distribución' };

// La fuente de datos (demo o base) se decide en cada pedido, según la configuración del servidor.
export const dynamic = 'force-dynamic';

type Loaded = { ok: true; view: DistributionConfigView } | { ok: false; message: string };

/** Lee la política del restaurante del contexto (en el servidor). */
async function loadFromDatabase(): Promise<Loaded> {
  try {
    const db = getDb();
    const access = await resolveAccess(db, configuredOperator());
    const view = await getDistributionConfigView(db, access);
    return view
      ? { ok: true, view }
      : {
          ok: false,
          message:
            'El restaurante todavía no tiene política de distribución. Inicializalo con db:bootstrap.',
        };
  } catch (error) {
    if (error instanceof AccessError) return { ok: false, message: error.message };
    console.error('[configuracion] no se pudo leer la política', error);
    return { ok: false, message: 'No se pudo leer la configuración desde la base de datos.' };
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
  const loaded = await loadFromDatabase();
  if (!loaded.ok) return <DatabaseProblem message={loaded.message} />;
  return <DatabaseDistributionConfig view={loaded.view} />;
}

function DatabaseProblem({ message }: { message: string }) {
  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <AlertTriangleIcon className="size-5" />
        </div>
        <CardTitle>No se puede mostrar la configuración</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}
