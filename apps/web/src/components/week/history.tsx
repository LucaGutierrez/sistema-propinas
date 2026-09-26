'use client';

import { ArrowRightIcon, CalendarRangeIcon } from 'lucide-react';
import Link from 'next/link';
import { WeekStatusBadge } from '@/components/gutip/badges';
import { LoadingState } from '@/components/gutip/loading';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMonth, formatWeekRange } from '@/lib/dates';
import { formatMoneyShort } from '@/lib/decimal';
import { monthlySummary, sortedWeeks, weekTotal } from '@/lib/demo-store/model';
import { useDemoStore } from '@/lib/demo-store/store';

export function History() {
  const { venue } = useDemoStore();
  if (!venue) return <LoadingState />;
  const months = monthlySummary(venue);
  const weeks = sortedWeeks(venue);

  return (
    <>
      <PageHeader
        title="Historial"
        description="Propina generada por mes y todas las semanas registradas."
      />

      <section aria-labelledby="meses">
        <h2 id="meses" className="mb-3 text-lg font-semibold">
          Por mes
        </h2>
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay pozos cargados.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {months.map((month) => (
              <Card key={month.month} className="gap-0 py-4">
                <CardContent className="px-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    {formatMonth(month.month)}
                  </p>
                  <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
                    {formatMoneyShort(month.generatedCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">propina generada</p>
                  <dl className="tabular mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Días</dt>
                      <dd className="font-medium">{month.daysWithTips}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Semanas cerradas</dt>
                      <dd className="font-medium">{month.closedWeeks}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">En sobres</dt>
                      <dd className="font-medium">{formatMoneyShort(month.envelopesCents)}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          La propina se asigna al mes de cada día. Los sobres, al mes en que termina la semana.
        </p>
      </section>

      <section aria-labelledby="semanas" className="mt-8">
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle id="semanas">Semanas</CardTitle>
            <CardDescription>{weeks.length} registradas</CardDescription>
          </CardHeader>
          <ul className="divide-y border-t">
            {weeks.map((week) => {
              const href = week.status === 'ABIERTA' ? '/semana' : `/semanas/${week.id}`;
              const pot = week.result ? BigInt(week.result.totalCents) : weekTotal(week).totalCents;
              return (
                <li key={week.id}>
                  <Link
                    href={href}
                    className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                      <CalendarRangeIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{formatWeekRange(week.startDate)}</p>
                      <p className="tabular text-sm text-muted-foreground">
                        Pozo {formatMoneyShort(pot)}
                        {week.result
                          ? ` · sobres ${formatMoneyShort(BigInt(week.result.totalFinalCents))} · ${week.result.rows.length} personas`
                          : ' · en curso'}
                      </p>
                    </div>
                    <WeekStatusBadge status={week.status} />
                    <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
    </>
  );
}
