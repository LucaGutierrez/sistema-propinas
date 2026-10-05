import { ArrowLeftIcon, LockIcon, MailIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { divRoundHalfUp, formatMoney, formatScaled } from '@/lib/decimal';
import { EVENT_LABEL, STATUS_LABEL } from '@/lib/envelopes/view';
import { formatWeight, METHOD_LABEL, weightInputsText } from '@/lib/distribution/period-view';
import type { HistoryDetail, HistoryEvent, HistoryPersonRow } from '@/lib/history/view';
import type { PortionDisplay } from '@/lib/policy/portion-format';
import { SectorBreakdown } from '@/components/distribution/sector-breakdown';
import { PeriodActions } from './period-actions';

const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});
const when = (iso: string) => dateTime.format(new Date(iso));
const money = (cents: string) => formatMoney(BigInt(cents));

function eventText(event: HistoryEvent): string {
  const who = event.employeeName ? ` · ${event.employeeName}` : '';
  const amount = event.amountCents ? ` · ${money(event.amountCents)}` : '';
  const label =
    event.kind === 'CLOSED'
      ? 'Reparto cerrado'
      : event.kind === 'VOIDED'
        ? 'Reparto anulado'
        : event.kind === 'DELIVERED'
          ? 'Sobre entregado'
          : event.kind === 'PREPARED'
            ? 'Sobre preparado'
            : EVENT_LABEL[event.kind];
  return `${label}${who}${amount} — por ${event.by} el ${when(event.at)}`;
}

/** "45 h × 0,022 de porción × 1,20 puntos = 1,188 de ponderado · 12,5 %" (todo del snapshot). */
function weightLine(p: HistoryPersonRow, display: PortionDisplay): string {
  return `${weightInputsText(p, display)} = ${formatWeight(BigInt(p.weightE8))} de ponderado · ${formatScaled(BigInt(p.percentE2), 2, 2)} %`;
}

/** Detalle histórico (solo lectura): exactamente lo que quedó guardado al cerrar. */
export function HistoryDetailView({ detail }: { detail: HistoryDetail }) {
  const totals = detail.totals;
  const pointValue =
    totals && BigInt(totals.weightE8) > 0n
      ? divRoundHalfUp(BigInt(totals.tipsCents) * 100_000_000n, BigInt(totals.weightE8))
      : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/historial"
          className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-primary hover:underline md:mb-4 md:min-h-0"
        >
          <ArrowLeftIcon className="size-4" />
          Historial
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Semana del {formatDayMonth(detail.weekStart)} al {formatShortDate(detail.weekEnd)}
              </h1>
              {detail.status === 'VOIDED' ? (
                <Badge variant="outline">Anulado</Badge>
              ) : (
                <Badge variant="success">
                  <LockIcon />
                  Cerrado
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {detail.closedAt
                ? `Cerrado el ${when(detail.closedAt)}${detail.closedBy ? ` por ${detail.closedBy}` : ''}`
                : ''}
              {detail.policyNumber ? ` · configuración versión ${detail.policyNumber}` : ''}
              {detail.roundingUnit
                ? ` · redondeo a ${detail.roundingUnit === 'PESO' ? 'pesos' : 'centavos'}`
                : ''}
            </p>
          </div>
          {detail.status === 'CLOSED' ? (
            <Button asChild variant="outline">
              <Link href={`/sobres/${detail.settlementId}`}>
                <MailIcon />
                Ver sobres
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {detail.status === 'VOIDED' ? (
        <div
          role="note"
          className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              Este reparto fue anulado
              {detail.voidedAt ? ` el ${when(detail.voidedAt)}` : ''}
              {detail.voidedBy ? ` por ${detail.voidedBy}` : ''}.
            </p>
            {detail.voidReason ? <p>Motivo: {detail.voidReason}</p> : null}
            <p className="text-muted-foreground">
              Se conserva tal como estaba; sus sobres ya no se entregan.
            </p>
          </div>
        </div>
      ) : null}

      {detail.supersedes ? (
        <p className="rounded-xl border bg-card p-4 text-sm">
          Este reparto rehace uno anulado de la misma semana.{' '}
          <Link
            href={`/historial/${detail.supersedes.settlementId}`}
            className="font-medium text-primary hover:underline"
          >
            Ver el reparto anulado
          </Link>
        </p>
      ) : null}

      {detail.ownOnly ? null : <PeriodActions detail={detail} />}

      {totals ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Propina repartida" value={money(totals.tipsCents)} strong />
          <Tile label="Adelantos descontados" value={money(totals.advancesCents)} />
          <Tile label="Personas" value={String(totals.participants)} />
          {detail.sectorStages ? (
            <Tile label="Cálculo" value="Por sectores" />
          ) : (
            <Tile
              label="Ponderado · valor de 1"
              value={`${formatWeight(BigInt(totals.weightE8))} · ${
                pointValue === null ? '—' : formatMoney(pointValue)
              }`}
            />
          )}
        </div>
      ) : null}

      {detail.sectorStages ? (
        <Card>
          <CardHeader>
            <CardTitle>Resultado por sector</CardTitle>
            <p className="text-sm text-muted-foreground">
              La configuración aplicada al cerrar (base y porcentaje de cada sector) y lo que
              recibió cada uno. Dentro de cada sector se repartió entre su gente según el detalle
              por persona.
            </p>
          </CardHeader>
          <CardContent>
            <SectorBreakdown summary={detail.sectorStages} />
          </CardContent>
        </Card>
      ) : null}

      {/* Detalle por persona */}
      <Card className="gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>{detail.ownOnly ? 'Lo que te correspondió' : 'Detalle por persona'}</CardTitle>
          {detail.detailAvailable ? (
            <p className="text-sm text-muted-foreground">
              Método de participación: {METHOD_LABEL[detail.method]}. Los valores son los que se
              usaron al cerrar.
            </p>
          ) : null}
          {detail.detailAvailable ? null : (
            <p className="text-sm text-muted-foreground">
              El detalle de horas y ponderado de este reparto anulado no está disponible; se
              muestran los importes de los sobres.
            </p>
          )}
        </CardHeader>
        {detail.people.length === 0 ? (
          <p className="border-t px-6 py-6 text-sm text-muted-foreground">
            No hay personas en este reparto.
          </p>
        ) : (
          <ul className="divide-y border-t">
            {detail.people.map((p) => (
              <li key={p.employeeId} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.positionName}
                      {detail.detailAvailable ? ` · ${weightLine(p, detail.portionDisplay)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold">{money(p.finalCents)}</p>
                    {BigInt(p.advancesCents) > 0n ? (
                      <p className="tabular text-xs text-muted-foreground">
                        {money(p.grossCents)} − adelanto {money(p.advancesCents)}
                      </p>
                    ) : null}
                    {p.envelope ? (
                      <p className="text-xs text-muted-foreground">
                        Sobre: {STATUS_LABEL[p.envelope.status]}
                        {p.envelope.reverted ? ' · tuvo una entrega revertida' : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Adelantos */}
      {detail.advances.length > 0 ? (
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Adelantos</CardTitle>
          </CardHeader>
          <ul className="divide-y border-t">
            {detail.advances.map((a) => (
              <li
                key={a.advanceId}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-6"
              >
                <div className="min-w-0">
                  <p className="font-medium">{a.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDayMonth(a.date)}
                    {a.note ? ` · ${a.note}` : ''}
                    {a.status === 'VOIDED' ? ' · anulado' : ''}
                    {a.reverted ? ' · el descuento se revirtió al anular el reparto' : ''}
                  </p>
                </div>
                <div className="tabular text-right text-xs">
                  <p>
                    Registrado <span className="font-medium">{money(a.amountCents)}</span>
                  </p>
                  <p>Descontado en este reparto {money(a.appliedHereCents)}</p>
                  <p className="text-muted-foreground">Pendiente hoy {money(a.pendingNowCents)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Actividad */}
      <Card>
        <CardHeader>
          <CardTitle>Actividad</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>
          ) : (
            <ol className="space-y-2 border-l pl-4 text-sm">
              {detail.events.map((event, index) => (
                <li key={`${event.kind}-${event.at}-${index}`}>
                  <p>{eventText(event)}</p>
                  {event.reason ? (
                    <p className="text-xs text-muted-foreground">Motivo: {event.reason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        El historial es de solo lectura y muestra los valores guardados al cerrar (horas, porciones,
        puntos e importes), aunque la configuración haya cambiado después.
        {detail.calcVersion ? ` Cálculo: ${detail.calcVersion}.` : ''}
      </p>
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? 'rounded-xl border border-primary/30 bg-primary/5 p-3'
          : 'rounded-xl border bg-card p-3'
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 font-semibold">{value}</p>
    </div>
  );
}
