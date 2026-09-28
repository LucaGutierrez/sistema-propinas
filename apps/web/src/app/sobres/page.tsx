import { ChevronRightIcon, MailIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import { AccessDenied, type AccessContext } from '@/server/access/access';
import { requireAccess } from '@/server/access/request';
import { CAN } from '@/server/access/roles';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { listEnvelopePeriods } from '@/server/envelopes/repository';

export const metadata: Metadata = { title: 'Sobres' };

export const dynamic = 'force-dynamic';

export default async function EnvelopesPage() {
  // En la demo, los sobres están dentro de cada semana.
  if (!databaseEnabled()) redirect('/historial');

  let access: AccessContext;
  try {
    access = await requireAccess({ roles: CAN.viewEnvelopes });
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.reason === 'UNAUTHENTICATED')
      redirect(`/login?next=${encodeURIComponent('/sobres')}`);
    redirect('/crear-restaurante');
  }

  const periods = await listEnvelopePeriods(getDb(), access);
  const own = access.role === 'SELF';

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {own ? 'Mis sobres' : 'Sobres'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {own
            ? 'Lo que te corresponde de cada reparto cerrado y si ya te lo entregaron.'
            : 'Después de cerrar un reparto, prepará el sobre de cada persona y registrá la entrega.'}
        </p>
      </div>

      {periods.length === 0 ? (
        <Card className="text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <MailIcon className="size-5" />
            </div>
            <CardTitle>Todavía no hay sobres</CardTitle>
            <CardDescription>
              {own
                ? 'Cuando se cierre un reparto en el que trabajaste, vas a ver tu sobre acá.'
                : 'Los sobres se generan cuando cerrás un reparto.'}
            </CardDescription>
          </CardHeader>
          {own ? null : (
            <div className="pb-6">
              <Button asChild>
                <Link href="/reparto">Ir a Repartir propinas</Link>
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {periods.map((p) => {
              const done = p.total > 0 && p.delivered === p.total;
              return (
                <li key={p.settlementId}>
                  <Link
                    href={`/sobres/${p.settlementId}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 sm:px-6"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">
                        Semana del {formatDayMonth(p.weekStart)} al {formatShortDate(p.weekEnd)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {p.delivered} de {p.total} entregados
                        {BigInt(p.toDeliverCents) > 0n
                          ? ` · falta entregar ${formatMoney(BigInt(p.toDeliverCents))}`
                          : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {done ? (
                        <Badge variant="success">Entregados</Badge>
                      ) : p.pending > 0 ? (
                        <Badge variant="warning">Por preparar</Badge>
                      ) : (
                        <Badge variant="secondary">Por entregar</Badge>
                      )}
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
