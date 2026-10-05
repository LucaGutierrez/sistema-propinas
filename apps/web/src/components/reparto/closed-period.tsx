'use client';

import { ArrowLeftIcon, CheckCircle2Icon, LockIcon, MailIcon, PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import { type ClosedPeriodView } from '@/lib/distribution/period-view';
import { SectorBreakdown } from '@/components/distribution/sector-breakdown';
import { sectorOnlyCents } from '@/lib/distribution/sector-snapshot';
import { CalculationDetail } from './calculation-detail';

const PAYMENT_LABEL = {
  PENDING: 'Sobre pendiente',
  PREPARED: 'Sobre preparado',
  DELIVERED: 'Entregado',
  VOIDED: 'Anulado',
} as const;

const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});

/** Un reparto cerrado: quién recibe cuánto (y la cuenta, plegada). Solo lectura. */
export function ClosedPeriod({
  view,
  justClosed,
}: {
  view: ClosedPeriodView;
  justClosed: boolean;
}) {
  const hasAdvances = BigInt(view.totalAdvancesCents) > 0n;
  // Lo de los sectores sin puestos se entrega al sector: está en el total, no en los sobres.
  const sectorOnly = sectorOnlyCents(view.sectorStages);
  const hoursE2 = (text: string) => {
    const [int = '0', frac = ''] = text.split(',');
    return BigInt(int.replace(/\./g, '')) * 100n + BigInt((frac + '00').slice(0, 2));
  };
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/reparto"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-primary hover:underline md:mb-4 md:min-h-0 print:hidden"
      >
        <ArrowLeftIcon className="size-4" />
        Repartos
      </Link>

      {justClosed ? (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm print:hidden"
        >
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Reparto cerrado y guardado.</p>
            <p className="text-muted-foreground">
              Ya quedó registrado cuánto recibe cada persona. El siguiente paso es preparar y
              entregar los sobres.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Semana del {formatDayMonth(view.weekStart)} al {formatShortDate(view.weekEnd)}
            </h1>
            {view.status === 'CLOSED' ? (
              <Badge variant="success">
                <LockIcon />
                Cerrado
              </Badge>
            ) : (
              <Badge variant="outline">Anulado</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.closedAt ? `Cerrado el ${dateTime.format(new Date(view.closedAt))}` : ''}
            {view.closedByName ? ` por ${view.closedByName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon />
            Imprimir planilla
          </Button>
          {view.status === 'CLOSED' ? (
            <Button asChild>
              <Link href={`/sobres/${view.settlementId}`}>
                <MailIcon />
                Preparar y entregar sobres
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="gap-0 py-0">
        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_8rem_8rem] gap-3 border-b bg-muted/40 px-6 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Persona</span>
          <span className="text-right">Le corresponde</span>
          <span className="text-right">Adelanto</span>
          <span className="text-right">A entregar</span>
        </div>
        <ul className="divide-y">
          {view.rows.map((r) => (
            <li
              key={r.employeeId}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem] sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.positionName} · {r.hours} h
                  {r.paymentStatus ? ` · ${PAYMENT_LABEL[r.paymentStatus]}` : ''}
                </p>
              </div>
              <p className="tabular hidden text-right sm:block">
                {formatMoney(BigInt(r.amountCents))}
              </p>
              <p className="tabular hidden text-right text-muted-foreground sm:block">
                {BigInt(r.advancesCents) > 0n ? `− ${formatMoney(BigInt(r.advancesCents))}` : '—'}
              </p>
              <div className="text-right">
                <p className="tabular font-semibold">{formatMoney(BigInt(r.finalCents))}</p>
                {BigInt(r.advancesCents) > 0n ? (
                  <p className="tabular text-xs text-muted-foreground sm:hidden">
                    {formatMoney(BigInt(r.amountCents))} − {formatMoney(BigInt(r.advancesCents))}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t bg-muted/40 px-4 py-3 text-sm sm:px-6">
          <div className="flex justify-between">
            <span>Propina repartida</span>
            <span className="tabular font-medium">{formatMoney(BigInt(view.totalCents))}</span>
          </div>
          {sectorOnly > 0n ? (
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>A sectores sin puestos</span>
              <span className="tabular">− {formatMoney(sectorOnly)}</span>
            </div>
          ) : null}
          {hasAdvances ? (
            <div className="flex justify-between text-muted-foreground">
              <span>Adelantos descontados</span>
              <span className="tabular">− {formatMoney(BigInt(view.totalAdvancesCents))}</span>
            </div>
          ) : null}
          {hasAdvances || sectorOnly > 0n ? (
            <div className="flex justify-between font-semibold">
              <span>A entregar en sobres</span>
              <span className="tabular">
                {formatMoney(BigInt(view.totalFinalCents) - sectorOnly)}
              </span>
            </div>
          ) : null}
        </div>
      </Card>

      {view.withoutHours.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No trabajaron (0 horas): {view.withoutHours.join(', ')}.
        </p>
      ) : null}

      {view.sectorStages ? (
        <section className="mt-4 rounded-xl border bg-card p-4">
          <h2 className="mb-1 font-medium">Reparto por sectores</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Paso a paso: sobre qué monto se calculó cada porcentaje, cuánto recibió cada sector y
            cuánto quedó.
          </p>
          <SectorBreakdown summary={view.sectorStages} />
        </section>
      ) : null}

      <div className="mt-4 print:hidden">
        <CalculationDetail
          rows={view.rows.map((r) => ({
            employeeId: r.employeeId,
            name: r.name,
            positionName: r.positionName,
            hoursE2: hoursE2(r.hours),
            factor: r.factor,
            individualPoints: r.individualPoints,
            weightE8: BigInt(r.weightE8),
            amountCents: BigInt(r.amountCents),
            advanceCents: BigInt(r.advancesCents),
            finalCents: BigInt(r.finalCents),
          }))}
          totalCents={BigInt(view.totalCents)}
          totalWeightE8={BigInt(view.totalWeightE8)}
          roundingLabel={view.roundingUnit === 'PESO' ? 'pesos enteros' : 'centavos'}
          method={view.method}
          portionDisplay={view.portionDisplay}
          sectors={view.sectorStages}
        />
      </div>

      <p className="mt-6 text-xs text-muted-foreground print:hidden">
        Un reparto cerrado no se puede modificar: así lo que se entrega siempre coincide con lo
        registrado. Los sobres se preparan y entregan en Sobres, con estos mismos importes.{' '}
        <Link href={`/historial/${view.settlementId}`} className="text-primary hover:underline">
          {view.status === 'VOIDED'
            ? 'Ver la anulación y rehacerlo en Historial'
            : '¿Hubo un error? Anularlo y rehacerlo desde Historial'}
        </Link>
      </p>
    </div>
  );
}
