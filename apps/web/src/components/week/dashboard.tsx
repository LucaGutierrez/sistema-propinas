'use client';

import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  MailIcon,
  RotateCcwIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { MyEnvelopes } from '@/components/access/my-envelopes';
import { WeekStatusBadge } from '@/components/gutip/badges';
import { LoadingState } from '@/components/gutip/loading';
import { StatCard } from '@/components/gutip/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMonth, formatWeekRange, todayIso } from '@/lib/dates';
import { formatMoneyShort } from '@/lib/decimal';
import { monthlySummary, openWeek, sortedWeeks, weekTotal } from '@/lib/demo-store/model';
import { useDemoStore } from '@/lib/demo-store/store';
import { envelopeSummary } from '@/lib/demo-store/envelopes';
import type { Week } from '@/lib/demo-store/model';

export function Dashboard() {
  const { venue, reset, perms, viewAs } = useDemoStore();
  if (!venue) return <LoadingState />;
  // "Solo lo suyo": su inicio es su propio resumen.
  if (!perms.viewAll) return <MyEnvelopes />;

  const current = openWeek(venue);
  const currentTotal = current ? weekTotal(current) : null;
  const thisMonth = todayIso().slice(0, 7);
  const month = monthlySummary(venue).find((m) => m.month === thisMonth);
  const lastClosed = sortedWeeks(venue).find((week) => week.status === 'CERRADA' && week.result);
  const activeStaff = venue.staff.filter((member) => member.active).length;

  return (
    <>
      <PageHeader
        title="Inicio"
        description={venue.name}
        actions={
          <Button asChild>
            <Link href="/semana">
              {current ? <CalendarDaysIcon /> : <CalendarPlusIcon />}
              {current ? 'Cargar pozo de hoy' : 'Empezar semana'}
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pozo de la semana"
          value={currentTotal ? formatMoneyShort(currentTotal.totalCents) : '—'}
          hint={
            current ? `${currentTotal?.daysWithTips ?? 0} de 7 días cargados` : 'Sin semana abierta'
          }
          icon={WalletIcon}
          tone="primary"
        />
        <StatCard
          label="Propina de este mes"
          value={formatMoneyShort(month?.generatedCents ?? 0n)}
          hint={formatMonth(thisMonth)}
          icon={TrendingUpIcon}
        />
        <StatCard
          label="Últimos sobres"
          value={
            lastClosed?.result ? formatMoneyShort(BigInt(lastClosed.result.totalFinalCents)) : '—'
          }
          hint={
            lastClosed ? formatWeekRange(lastClosed.startDate) : 'Todavía no hay semanas cerradas'
          }
          icon={MailIcon}
        />
        <StatCard
          label="Personal activo"
          value={activeStaff}
          hint={`${venue.positions.length} puestos`}
          icon={UsersIcon}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Semana actual</CardTitle>
            <CardDescription>
              {current ? formatWeekRange(current.startDate) : 'No hay ninguna semana abierta.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {current && currentTotal ? (
              <Link
                href="/semana"
                className="group flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div>
                  <p className="tabular text-2xl font-semibold">
                    {formatMoneyShort(currentTotal.totalCents)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    acumulado · {currentTotal.daysWithTips} de 7 días
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <WeekStatusBadge status="ABIERTA" />
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ) : (
              <Button asChild variant="outline">
                <Link href="/semana">
                  <CalendarPlusIcon />
                  Empezar una semana
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Última semana cerrada</CardTitle>
            <CardDescription>
              {lastClosed
                ? formatWeekRange(lastClosed.startDate)
                : 'Todavía no hay semanas cerradas.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lastClosed?.result ? (
              <Link
                href={`/semanas/${lastClosed.id}`}
                className="group flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div>
                  <p className="tabular text-2xl font-semibold">
                    {formatMoneyShort(BigInt(lastClosed.result.totalFinalCents))}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    pozo {formatMoneyShort(BigInt(lastClosed.result.totalCents))}
                  </p>
                  <DeliveryProgress week={lastClosed} />
                </div>
                <div className="flex items-center gap-2">
                  <WeekStatusBadge status="CERRADA" />
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {viewAs ? null : <DemoResetBox onReset={reset} />}
    </>
  );
}

/** Solo para el dueño de la cuenta: borra todo y vuelve a los datos de ejemplo. */
function DemoResetBox({ onReset }: { onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = onReset;
  return (
    <>
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Modo demo: los datos se guardan solo en este navegador. Restablecer borra todos los
          locales y vuelve al local de ejemplo con la semana de la planilla (noviembre de 2024).
        </p>
        {confirmReset ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              Sí, borrar todo
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcwIcon />
            Restablecer datos demo
          </Button>
        )}
      </div>
    </>
  );
}

/** Cuántos sobres de la semana ya se entregaron. */
function DeliveryProgress({ week }: { week: Week }) {
  const summary = envelopeSummary(week);
  const withAmount = summary.total - summary.sinImporte;
  const done = withAmount > 0 && summary.entregados === withAmount;
  return (
    <p
      className={
        done ? 'mt-1 text-sm font-medium text-primary' : 'mt-1 text-sm text-warning-foreground'
      }
    >
      {done
        ? 'Todos los sobres entregados'
        : `${withAmount - summary.entregados} de ${withAmount} sobres por entregar · ${formatMoneyShort(summary.pendingCents)}`}
    </p>
  );
}
