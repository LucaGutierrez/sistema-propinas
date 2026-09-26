'use client';

import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  HandCoinsIcon,
  MailIcon,
  PencilIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { DistributionTable } from '@/components/distribution/distribution-table';
import { PositionBadge, ProvisionalBadge, WeekStatusBadge } from '@/components/gutip/badges';
import { FormulaCard } from '@/components/gutip/formula-card';
import { LoadingState } from '@/components/gutip/loading';
import { StatCard } from '@/components/gutip/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDayMonth, formatWeekRange, formatWeekday, weekDays } from '@/lib/dates';
import { formatMoney, formatMoneyShort, parseMoney } from '@/lib/decimal';
import { findWeek, weekTotal } from '@/lib/demo-store/model';
import { useDemoStore } from '@/lib/demo-store/store';
import { closedRowsView, closedTotalsView } from '@/lib/demo-store/views';

const CLOSED_AT = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

export function WeekDetail({ weekId }: { weekId: string }) {
  const { venue } = useDemoStore();
  if (!venue) return <LoadingState />;

  const week = findWeek(venue, weekId);
  if (!week) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle>No encontramos esa semana</CardTitle>
          <CardDescription>Puede que se hayan restablecido los datos de la demo.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/historial">Ver historial</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (week.status === 'ABIERTA' || !week.result) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle>{formatWeekRange(week.startDate)}</CardTitle>
          <CardDescription>
            Esta semana sigue abierta. Los sobres se calculan al cerrarla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/semana">
              <PencilIcon />
              Ir a la semana actual
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { result } = week;
  const rows = closedRowsView(venue, result);
  const envelopes = rows.filter((row) => row.finalCents > 0n || row.pendingAdvanceCents > 0n);
  const total = weekTotal(week);
  const days = weekDays(week.startDate);

  return (
    <>
      <Link
        href="/historial"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Historial
      </Link>
      <PageHeader
        title={formatWeekRange(week.startDate)}
        description={`Cerrada el ${CLOSED_AT.format(new Date(result.closedAt))}`}
        actions={
          <>
            <ProvisionalBadge />
            <WeekStatusBadge status="CERRADA" className="px-3 py-1 text-sm" />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Pozo de la semana"
          value={formatMoneyShort(BigInt(result.totalCents))}
          icon={WalletIcon}
          tone="primary"
        />
        <StatCard
          label="Días con pozo"
          value={`${total.daysWithTips} / 7`}
          icon={CalendarDaysIcon}
        />
        <StatCard
          label="Adelantos descontados"
          value={formatMoneyShort(BigInt(result.totalAdvanceCents))}
          icon={HandCoinsIcon}
        />
        <StatCard
          label="Total en sobres"
          value={formatMoneyShort(BigInt(result.totalFinalCents))}
          hint={`${envelopes.length} sobres`}
          icon={MailIcon}
        />
      </div>

      {week.note ? <p className="mt-4 text-sm text-muted-foreground">{week.note}</p> : null}

      {/* Sobres */}
      <section aria-labelledby="sobres" className="mt-8">
        <h2 id="sobres" className="mb-1 text-lg font-semibold">
          Sobres
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Lo que hay que poner en el sobre de cada persona.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {envelopes.map((row) => (
            <Card key={row.id} className="gap-3 py-4">
              <CardContent className="px-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{row.name}</p>
                  <PositionBadge name={row.positionName} tone={row.tone} />
                </div>
                <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
                  {formatMoney(row.finalCents)}
                </p>
                <dl className="tabular mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>Propina</dt>
                    <dd>{formatMoney(row.amountCents)}</dd>
                  </div>
                  {row.advanceCents > 0n ? (
                    <div className="flex justify-between">
                      <dt>Adelanto</dt>
                      <dd>− {formatMoney(row.advanceCents)}</dd>
                    </div>
                  ) : null}
                  {row.pendingAdvanceCents > 0n ? (
                    <div className="flex justify-between text-warning-foreground">
                      <dt>Saldo a la próxima semana</dt>
                      <dd>{formatMoney(row.pendingAdvanceCents)}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-4">
        <Card className="gap-0 pb-2 xl:col-span-1">
          <CardHeader className="pb-4">
            <CardTitle>Pozo por día</CardTitle>
          </CardHeader>
          <ul className="divide-y border-t text-sm">
            {days.map((date) => {
              const cents = parseMoney(week.tips[date] ?? '') ?? 0n;
              return (
                <li key={date} className="flex justify-between px-5 py-2">
                  <span className="capitalize">
                    {formatWeekday(date)}{' '}
                    <span className="text-muted-foreground">{formatDayMonth(date)}</span>
                  </span>
                  <span className="tabular">{cents > 0n ? formatMoney(cents) : '—'}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="gap-0 pb-0 xl:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle>Detalle del reparto</CardTitle>
            <CardDescription>Horas, factores y puntos tal como quedaron al cerrar.</CardDescription>
          </CardHeader>
          <DistributionTable rows={rows} totals={closedTotalsView(result)} />
        </Card>
      </div>

      <FormulaCard className="mt-6" />
    </>
  );
}
