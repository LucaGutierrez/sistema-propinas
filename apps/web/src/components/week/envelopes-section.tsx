'use client';

import {
  CheckCheckIcon,
  CheckIcon,
  HandIcon,
  PackageCheckIcon,
  PrinterIcon,
  RotateCcwIcon,
  Undo2Icon,
} from 'lucide-react';
import { useState } from 'react';
import type { DistributionRowView } from '@/components/distribution/distribution-table';
import { PositionBadge } from '@/components/gutip/badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatWeekRange } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import {
  MIN_REASON_LENGTH,
  deliverEnvelope,
  envelopeOf,
  envelopeSummary,
  prepareAllEnvelopes,
  prepareEnvelope,
  revertDelivery,
  undoPreparation,
  type Envelope,
  type EnvelopeEventType,
  type EnvelopeStatus,
} from '@/lib/demo-store/envelopes';
import type { Venue, Week } from '@/lib/demo-store/model';
import { useDemoStore } from '@/lib/demo-store/store';
import { cn } from '@/lib/utils';

const WHEN = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const when = (iso?: string) => (iso ? WHEN.format(new Date(iso)) : '');

const STATUS_LABEL: Record<EnvelopeStatus, string> = {
  PENDIENTE: 'Pendiente',
  PREPARADO: 'Preparado',
  ENTREGADO: 'Entregado',
};

const EVENT_LABEL: Record<EnvelopeEventType, string> = {
  PREPARADO: 'Preparado',
  PREPARACION_DESHECHA: 'Preparación deshecha',
  ENTREGADO: 'Entregado',
  ENTREGA_REVERTIDA: 'Entrega revertida',
};

export function EnvelopeStatusBadge({ status }: { status: EnvelopeStatus }) {
  return (
    <Badge
      variant={status === 'ENTREGADO' ? 'success' : status === 'PREPARADO' ? 'outline' : 'warning'}
      className={cn(status === 'PREPARADO' && 'border-sky-200 bg-sky-50 text-sky-800')}
    >
      {status === 'ENTREGADO' ? <CheckIcon /> : null}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Quién figura en la bitácora: la persona simulada con "Ver como…" o el encargado. */
function useActor(): string {
  const { viewAs } = useDemoStore();
  return viewAs?.name ?? 'Encargado';
}

export function EnvelopesSection({
  week,
  rows,
}: {
  week: Week;
  rows: readonly DistributionRowView[];
}) {
  const { apply, perms } = useDemoStore();
  const actor = useActor();
  const [error, setError] = useState<string | null>(null);
  const summary = envelopeSummary(week);
  const withEnvelope = rows.filter((row) => row.amountCents > 0n);
  const withAmount = summary.total - summary.sinImporte;
  const progress = withAmount > 0 ? Math.round((summary.entregados * 100) / withAmount) : 0;

  return (
    <section aria-labelledby="sobres" className="mt-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="sobres" className="text-lg font-semibold">
            Sobres
          </h2>
          <p className="text-sm text-muted-foreground">
            Prepará cada sobre, entregalo y queda registrado quién y cuándo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <PrinterIcon />
            Imprimir planilla
          </Button>
          {perms.handleEnvelopes && summary.pendientes > 0 ? (
            <Button
              size="sm"
              onClick={() =>
                setError(
                  apply((v) => prepareAllEnvelopes(v, week.id, actor, new Date().toISOString())),
                )
              }
            >
              <CheckCheckIcon />
              Preparar todos ({summary.pendientes})
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="mb-4 gap-3 py-4">
        <CardContent className="px-4">
          <div className="tabular flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <strong>{summary.entregados}</strong> de {withAmount} entregados
            </span>
            <span className="text-muted-foreground">
              {summary.preparados} preparados · {summary.pendientes} pendientes
              {summary.sinImporte > 0 ? ` · ${summary.sinImporte} sin importe` : ''}
            </span>
            <span className="text-muted-foreground sm:ml-auto">
              Falta entregar{' '}
              <strong className="text-foreground">{formatMoney(summary.pendingCents)}</strong>
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Sobres entregados"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          {!perms.handleEnvelopes ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Solo el encargado prepara y entrega los sobres.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {withEnvelope.map((row) => (
          <EnvelopeCard
            key={row.id}
            week={week}
            row={row}
            envelope={envelopeOf(week, row.id)}
            onError={setError}
          />
        ))}
      </div>
    </section>
  );
}

type Mode = 'idle' | 'deliver' | 'undo' | 'revert';

function EnvelopeCard({
  week,
  row,
  envelope,
  onError,
}: {
  week: Week;
  row: DistributionRowView;
  envelope: Envelope;
  onError: (error: string | null) => void;
}) {
  const { apply, perms } = useDemoStore();
  const actor = useActor();
  const [mode, setMode] = useState<Mode>('idle');
  const [text, setText] = useState('');
  const noAmount = row.finalCents === 0n;

  function run(action: Parameters<typeof apply>[0]) {
    const failure = apply(action);
    onError(failure);
    if (!failure) {
      setMode('idle');
      setText('');
    }
  }

  const now = () => new Date().toISOString();
  const reasonOk = text.trim().length >= MIN_REASON_LENGTH;

  return (
    <Card
      className={cn(
        'gap-3 py-4',
        envelope.status === 'ENTREGADO' && 'border-primary/30 bg-primary/5',
      )}
    >
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <PositionBadge name={row.positionName} tone={row.tone} />
          </div>
          {noAmount ? (
            <Badge variant="outline" className="text-muted-foreground">
              Sin importe
            </Badge>
          ) : (
            <EnvelopeStatusBadge status={envelope.status} />
          )}
        </div>

        <div>
          <p className="tabular text-2xl font-semibold tracking-tight">
            {formatMoney(row.finalCents)}
          </p>
          <dl className="tabular mt-1 space-y-0.5 text-xs text-muted-foreground">
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
        </div>

        {noAmount ? (
          <p className="text-xs text-muted-foreground">
            Los adelantos se llevaron todo: no hay importe para entregar.
          </p>
        ) : null}

        {envelope.status === 'ENTREGADO' ? (
          <p className="text-xs text-muted-foreground">
            Entregado el {when(envelope.deliveredAt)} por {envelope.deliveredBy}
            {envelope.deliveryNote ? ` · “${envelope.deliveryNote}”` : ''}
          </p>
        ) : envelope.status === 'PREPARADO' ? (
          <p className="text-xs text-muted-foreground">
            Preparado el {when(envelope.preparedAt)} por {envelope.preparedBy}
          </p>
        ) : null}

        {/* Acciones */}
        {!noAmount && mode === 'idle' ? (
          <div className="flex flex-wrap gap-2">
            {envelope.status === 'PENDIENTE' && perms.handleEnvelopes ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run((v) => prepareEnvelope(v, week.id, row.id, actor, now()))}
              >
                <PackageCheckIcon />
                Preparar
              </Button>
            ) : null}
            {envelope.status === 'PREPARADO' && perms.handleEnvelopes ? (
              <>
                <Button size="sm" onClick={() => setMode('deliver')}>
                  <HandIcon />
                  Entregar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('undo')}>
                  <Undo2Icon />
                  Deshacer
                </Button>
              </>
            ) : null}
            {envelope.status === 'ENTREGADO' && perms.revertDelivery ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setMode('revert')}
              >
                <RotateCcwIcon />
                Revertir entrega
              </Button>
            ) : null}
          </div>
        ) : null}

        {mode === 'deliver' ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              run((v) => deliverEnvelope(v, week.id, row.id, actor, now(), text));
            }}
          >
            <Input
              aria-label={`Nota de entrega para ${row.name}`}
              placeholder="Nota (opcional)"
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                <CheckIcon />
                Confirmar entrega de {formatMoney(row.finalCents)}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode('idle')}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}

        {mode === 'undo' || mode === 'revert' ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              run((v) =>
                mode === 'undo'
                  ? undoPreparation(v, week.id, row.id, actor, now(), text)
                  : revertDelivery(v, week.id, row.id, actor, now(), text),
              );
            }}
          >
            <p className="text-xs font-medium">
              {mode === 'undo'
                ? 'Motivo para deshacer la preparación'
                : 'Motivo para revertir la entrega'}
            </p>
            <Input
              aria-label="Motivo"
              placeholder={`Mínimo ${MIN_REASON_LENGTH} caracteres`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant={mode === 'revert' ? 'destructive' : 'default'}
                disabled={!reasonOk}
              >
                {mode === 'undo' ? 'Deshacer preparación' : 'Revertir entrega'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode('idle')}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}

        {envelope.events.length > 0 ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Historial ({envelope.events.length})
            </summary>
            <ol className="mt-2 space-y-1 border-l pl-3">
              {envelope.events.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <span className="font-medium">{EVENT_LABEL[event.type]}</span>{' '}
                  <span className="text-muted-foreground">
                    · {when(event.at)} · {event.by}
                  </span>
                  {event.reason ? (
                    <span className="block text-muted-foreground">Motivo: {event.reason}</span>
                  ) : null}
                  {event.note ? (
                    <span className="block text-muted-foreground">Nota: {event.note}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Planilla para imprimir y firmar al entregar los sobres. Solo aparece al imprimir. */
export function EnvelopesPrintSheet({
  venue,
  week,
  rows,
}: {
  venue: Venue;
  week: Week;
  rows: readonly DistributionRowView[];
}) {
  const withEnvelope = rows.filter((row) => row.amountCents > 0n);
  const total = withEnvelope.reduce((sum, row) => sum + row.finalCents, 0n);
  return (
    <div className="hidden text-black print:block">
      <h1 className="text-xl font-bold">
        {venue.name} · Sobres · {formatWeekRange(week.startDate)}
      </h1>
      <p className="mb-4 text-sm">Fórmula provisional. Impreso el {WHEN.format(new Date())}.</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-black px-2 py-1 text-left">Nombre</th>
            <th className="border border-black px-2 py-1 text-left">Puesto</th>
            <th className="border border-black px-2 py-1 text-right">Propina</th>
            <th className="border border-black px-2 py-1 text-right">Adelanto</th>
            <th className="border border-black px-2 py-1 text-right">Sobre</th>
            <th className="border border-black px-2 py-1 text-left">Estado</th>
            <th className="w-40 border border-black px-2 py-1 text-left">Firma</th>
          </tr>
        </thead>
        <tbody>
          {withEnvelope.map((row) => (
            <tr key={row.id}>
              <td className="border border-black px-2 py-2">{row.name}</td>
              <td className="border border-black px-2 py-2">{row.positionName}</td>
              <td className="border border-black px-2 py-2 text-right">
                {formatMoney(row.amountCents)}
              </td>
              <td className="border border-black px-2 py-2 text-right">
                {row.advanceCents > 0n ? `− ${formatMoney(row.advanceCents)}` : ''}
              </td>
              <td className="border border-black px-2 py-2 text-right font-semibold">
                {formatMoney(row.finalCents)}
              </td>
              <td className="border border-black px-2 py-2">
                {row.finalCents === 0n
                  ? 'Sin importe'
                  : STATUS_LABEL[envelopeOf(week, row.id).status]}
              </td>
              <td className="border border-black px-2 py-2" />
            </tr>
          ))}
          <tr>
            <td className="border border-black px-2 py-1 font-semibold" colSpan={4}>
              Total
            </td>
            <td className="border border-black px-2 py-1 text-right font-semibold">
              {formatMoney(total)}
            </td>
            <td className="border border-black px-2 py-1" colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
