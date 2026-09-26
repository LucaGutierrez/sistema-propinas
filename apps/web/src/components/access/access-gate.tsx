'use client';

import { LockIcon } from 'lucide-react';
import Link from 'next/link';
import { LoadingState } from '@/components/gutip/loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDemoStore } from '@/lib/demo-store/store';

type Need = 'viewAll' | 'manageAccess' | 'owner';

/**
 * Muestra la sección solo si el permiso actual lo permite. `owner` es el dueño de la cuenta
 * (no disponible mientras se usa "Ver como…").
 */
export function AccessGate({ need, children }: { need: Need; children: React.ReactNode }) {
  const { workspace, perms, viewAs } = useDemoStore();
  if (!workspace) return <LoadingState />;
  const allowed = need === 'owner' ? viewAs === null : perms[need];
  if (allowed) return <>{children}</>;

  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <LockIcon className="size-5" />
        </div>
        <CardTitle>No tenés acceso a esta sección</CardTitle>
        <CardDescription>
          {perms.viewAll
            ? 'Esta sección es solo para el encargado del local.'
            : 'Con tu permiso solo podés ver tu propio sobre.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href={perms.viewAll ? '/' : '/mis-sobres'}>
            {perms.viewAll ? 'Ir al inicio' : 'Ver mis sobres'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
