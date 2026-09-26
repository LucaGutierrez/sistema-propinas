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
import { ProvisionalBadge, WeekStatusBadge } from '@/components/gutip/badges';
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
import { envelopeSummary } from '@/lib/demo-store/envelopes';
import { AdvancesCard } from './advances-card';
import { EnvelopesPrintSheet, EnvelopesSection } from './envelopes-section';
import { RevisionNotice } from './revision-notice';
import { VoidWeekCard } from './void-week-card';

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
  const envelopes = envelopeSummary(week);
  const total = weekTotal(week);
  const days = weekDays(week.startDate);

  return (
    <>
      <EnvelopesPrintSheet venue={venue} week={week} rows={rows} />
      {/* Al imprimir solo sale la planilla de sobres. */}
      <div className="print:hidden">
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
            hint={`${envelopes.entregados} de ${envelopes.total - envelopes.sinImporte} entregados`}
            icon={MailIcon}
          />
        </div>

        {week.note ? <p className="mt-4 text-sm text-muted-foreground">{week.note}</p> : null}
        <RevisionNotice week={week} />

        <EnvelopesSection week={week} rows={rows} />

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
              <CardDescription>
                Horas, factores y puntos tal como quedaron al cerrar.
              </CardDescription>
            </CardHeader>
            <DistributionTable rows={rows} totals={closedTotalsView(result)} />
          </Card>
        </div>

        <AdvancesCard venue={venue} week={week} className="mt-6" />
        <FormulaCard className="mt-6" />
        <VoidWeekCard venue={venue} week={week} />
      </div>
    </>
  );
}
