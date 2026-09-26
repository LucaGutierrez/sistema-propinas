'use client';

import { ClockIcon, HandCoinsIcon, MailIcon, TrendingUpIcon } from 'lucide-react';
import Link from 'next/link';
import { PositionBadge, toneOf } from '@/components/gutip/badges';
import { LoadingState } from '@/components/gutip/loading';
import { StatCard } from '@/components/gutip/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatWeekRange, todayIso, addDays } from '@/lib/dates';
import { formatMoney, formatMoneyShort } from '@/lib/decimal';
import { EnvelopeStatusBadge } from '@/components/week/envelopes-section';
import { envelopeOf } from '@/lib/demo-store/envelopes';
import {
  advanceTotal,
  openWeek,
  positionById,
  sortedWeeks,
  type Week,
} from '@/lib/demo-store/model';
import { useDemoStore } from '@/lib/demo-store/store';

/** Lo de una sola persona: sus sobres, sus horas y sus adelantos. Nada de los demás. */
export function MyEnvelopes() {
  const { venue, perms } = useDemoStore();
  if (!venue) return <LoadingState />;

  const staffId = perms.ownStaffId;
  const member = venue.staff.find((s) => s.id === staffId);
  if (!staffId || !member) {
    return (
      <>
        <PageHeader title="Mis sobres" />
        <Card className="mx-auto max-w-lg text-center">
          <CardHeader>
            <CardTitle>Esta es la vista de cada empleado</CardTitle>
            <CardDescription>
              Quien tiene el permiso &quot;Solo lo suyo&quot; ve acá únicamente su sobre, sus horas
              y sus adelantos. Probala con &quot;Ver como…&quot; desde Acceso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/acceso">Ir a Acceso</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const position = positionById(venue, member.positionId);
  const current = openWeek(venue);
  const closed = sortedWeeks(venue)
    .filter((week) => week.status === 'CERRADA' && week.result)
    .map((week) => ({ week, row: week.result?.rows.find((r) => r.staffId === staffId) }))
    .filter((entry) => entry.row !== undefined);
  const thisMonth = todayIso().slice(0, 7);
  const monthCents = closed
    .filter(({ week }) => addDays(week.startDate, 6).slice(0, 7) === thisMonth)
    .reduce((sum, { row }) => sum + BigInt(row?.finalCents ?? '0'), 0n);
  const last = closed[0];
  const currentAdvance = current ? advanceTotal(current, staffId) : 0n;

  return (
    <>
      <PageHeader
        title={`Hola, ${member.name}`}
        description={
          <span className="flex items-center gap-2">
            {venue.name}
            <PositionBadge
              name={position?.name ?? ''}
              tone={toneOf(venue.positions, member.positionId)}
            />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Último sobre"
          value={last?.row ? formatMoneyShort(BigInt(last.row.finalCents)) : '—'}
          hint={last ? formatWeekRange(last.week.startDate) : 'Todavía no hay semanas cerradas'}
          icon={MailIcon}
          tone="primary"
        />
        <StatCard
          label="Cobrado este mes"
          value={formatMoneyShort(monthCents)}
          hint="En sobres de semanas cerradas"
          icon={TrendingUpIcon}
        />
        <StatCard
          label="Horas cargadas esta semana"
          value={current ? `${current.hours[staffId] || '0'} h` : '—'}
          hint={current ? formatWeekRange(current.startDate) : 'Sin semana abierta'}
          icon={ClockIcon}
        />
        <StatCard
          label="Adelantos esta semana"
          value={current ? formatMoneyShort(currentAdvance) : '—'}
          hint="Se descuentan al cerrar la semana"
          icon={HandCoinsIcon}
        />
      </div>

      <Card className="mt-6 gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Mis sobres</CardTitle>
          <CardDescription>Semana por semana, lo que te tocó y lo que se descontó.</CardDescription>
        </CardHeader>
        {closed.length === 0 ? (
          <p className="border-t px-5 py-8 text-center text-sm text-muted-foreground">
            Todavía no cobraste ningún sobre en {venue.name}.
          </p>
        ) : (
          <ul className="divide-y border-t">
            {closed.map(({ week, row }) =>
              row ? (
                <li key={week.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{formatWeekRange(week.startDate)}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      Propina {formatMoney(BigInt(row.amountCents))}
                      {BigInt(row.advanceCents) > 0n
                        ? ` − adelanto ${formatMoney(BigInt(row.advanceCents))}`
                        : ''}
                      {BigInt(row.pendingAdvanceCents) > 0n
                        ? ` · saldo pendiente ${formatMoney(BigInt(row.pendingAdvanceCents))}`
                        : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-lg font-semibold">
                      {formatMoney(BigInt(row.finalCents))}
                    </p>
                    <MyEnvelopeStatus
                      week={week}
                      staffId={staffId}
                      hasAmount={BigInt(row.finalCents) > 0n}
                    />
                  </div>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </Card>
    </>
  );
}

const DELIVERED_AT = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Estado del propio sobre: si ya lo entregaron, cuándo. */
function MyEnvelopeStatus({
  week,
  staffId,
  hasAmount,
}: {
  week: Week;
  staffId: string;
  hasAmount: boolean;
}) {
  if (!hasAmount) return <p className="text-xs text-muted-foreground">Sin importe</p>;
  const envelope = envelopeOf(week, staffId);
  return (
    <div className="mt-1 flex flex-col items-end gap-0.5">
      <EnvelopeStatusBadge status={envelope.status} />
      {envelope.status === 'ENTREGADO' && envelope.deliveredAt ? (
        <span className="text-xs text-muted-foreground">
          {DELIVERED_AT.format(new Date(envelope.deliveredAt))}
        </span>
      ) : null}
    </div>
  );
}
