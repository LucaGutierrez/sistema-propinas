'use client';

import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HandCoinsIcon,
  LoaderCircleIcon,
  PackageCheckIcon,
  PrinterIcon,
  Undo2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  deliverEnvelopeAction,
  prepareEnvelopesAction,
  revertDeliveryAction,
  undoPreparationAction,
  type EnvelopeActionResult,
} from '@/app/sobres/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import {
  EVENT_LABEL,
  MIN_REASON_LENGTH,
  STATUS_LABEL,
  summarize,
  type EnvelopesPeriodView,
  type EnvelopeView,
} from '@/lib/envelopes/view';
import { cn } from '@/lib/utils';

const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});
const when = (iso: string) => dateTime.format(new Date(iso));

type Feedback = { error: boolean; text: string } | null;

/** Sobres de un reparto cerrado: preparar, entregar y corregir (según permisos). */
export function EnvelopesBoard({ view }: { view: EnvelopesPeriodView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const summary = summarize(view.envelopes);

  async function act(key: string, task: () => Promise<EnvelopeActionResult>): Promise<boolean> {
    setBusy(key);
    setFeedback(null);
    const result = await task().catch((): EnvelopeActionResult => ({
      ok: false,
      error: 'No se pudo guardar. Revisá tu conexión y probá de nuevo.',
    }));
    setBusy(null);
    setFeedback(
      result.ok ? { error: false, text: result.message } : { error: true, text: result.error },
    );
    if (result.ok) router.refresh();
    return result.ok;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/sobres"
        className="mb-4 flex items-center gap-1.5 text-sm text-primary hover:underline print:hidden"
      >
        <ArrowLeftIcon className="size-4" />
        Sobres
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {view.ownOnly ? 'Mis sobres' : 'Sobres'}
            </h1>
            {view.status === 'VOIDED' ? <Badge variant="outline">Reparto anulado</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Semana del {formatDayMonth(view.weekStart)} al {formatShortDate(view.weekEnd)} · los
            importes salen del reparto cerrado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {view.ownOnly ? null : (
            <Button asChild variant="outline">
              <Link href={`/reparto/${view.settlementId}`}>Ver el reparto</Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Resumen */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Falta entregar" value={formatMoney(summary.toDeliverCents)} strong />
        <SummaryTile label="Entregado" value={formatMoney(summary.deliveredCents)} />
        <SummaryTile
          label="Sobres"
          value={`${summary.delivered} de ${summary.total - summary.withoutAmount} entregados`}
        />
        <SummaryTile
          label="Por preparar"
          value={`${summary.pending} pendiente${summary.pending === 1 ? '' : 's'}`}
        />
      </div>

      {view.canHandle && summary.pending > 0 ? (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <p className="text-sm text-muted-foreground">
            Prepará los sobres (poné la plata en cada uno) y después marcá cada entrega.
          </p>
          <Button
            onClick={() => void act('all', () => prepareEnvelopesAction(view.settlementId))}
            disabled={busy !== null}
          >
            {busy === 'all' ? <LoaderCircleIcon className="animate-spin" /> : <PackageCheckIcon />}
            Preparar todos ({summary.pending})
          </Button>
        </div>
      ) : null}

      {feedback ? (
        <p
          role={feedback.error ? 'alert' : 'status'}
          className={cn(
            'mb-4 rounded-lg px-3 py-2 text-sm print:hidden',
            feedback.error ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
          )}
        >
          {feedback.text}
        </p>
      ) : null}

      {view.envelopes.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {view.ownOnly
            ? 'No tenés sobre en este reparto.'
            : 'Este reparto no tiene sobres (nadie tuvo propina).'}
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {view.envelopes.map((envelope) => (
              <EnvelopeRow
                key={envelope.paymentId}
                envelope={envelope}
                canHandle={view.canHandle}
                canRevert={view.canRevert}
                busy={busy}
                act={act}
                settlementId={view.settlementId}
              />
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-6 text-xs text-muted-foreground print:hidden">
        Cada paso queda registrado con quién y cuándo. Una entrega no se edita: si hubo un error, el
        Dueño o el Encargado la revierte con un motivo y queda en el historial.
      </p>
    </div>
  );
}

function SummaryTile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn('rounded-xl border bg-card p-3', strong && 'border-primary/30 bg-primary/5')}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ envelope }: { envelope: EnvelopeView }) {
  if (BigInt(envelope.netCents) === 0n) return <Badge variant="outline">Sin importe</Badge>;
  const variant =
    envelope.status === 'DELIVERED'
      ? 'success'
      : envelope.status === 'PREPARED'
        ? 'secondary'
        : envelope.status === 'VOIDED'
          ? 'outline'
          : 'warning';
  return <Badge variant={variant}>{STATUS_LABEL[envelope.status]}</Badge>;
}

function EnvelopeRow({
  envelope,
  canHandle,
  canRevert,
  busy,
  act,
  settlementId,
}: {
  envelope: EnvelopeView;
  canHandle: boolean;
  canRevert: boolean;
  busy: string | null;
  act: (key: string, task: () => Promise<EnvelopeActionResult>) => Promise<boolean>;
  settlementId: string;
}) {
  const [mode, setMode] = useState<'none' | 'deliver' | 'undo' | 'revert'>('none');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState(false);
  const net = BigInt(envelope.netCents);
  const advances = BigInt(envelope.advancesCents);
  const hasAmount = net > 0n;
  const key = envelope.paymentId;
  const working = busy === key;
  const reasonOk = reason.trim().length >= MIN_REASON_LENGTH;

  async function run(task: () => Promise<EnvelopeActionResult>) {
    if (await act(key, task)) {
      setMode('none');
      setReason('');
    }
  }

  return (
    <li className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{envelope.name}</p>
          <p className="text-xs text-muted-foreground">
            {envelope.positionName ?? '—'}
            {advances > 0n
              ? ` · ${formatMoney(BigInt(envelope.grossCents))} − adelanto ${formatMoney(advances)}`
              : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {envelope.status === 'DELIVERED' && envelope.deliveredAt
              ? `Entregado por ${envelope.deliveredBy ?? '—'} el ${when(envelope.deliveredAt)}`
              : envelope.status === 'PREPARED' && envelope.preparedAt
                ? `Preparado por ${envelope.preparedBy ?? '—'} el ${when(envelope.preparedAt)}`
                : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular text-lg font-semibold">{formatMoney(net)}</span>
          <StatusBadge envelope={envelope} />
        </div>
      </div>

      {/* Acciones */}
      {hasAmount && envelope.status !== 'VOIDED' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
          {canHandle && envelope.status === 'PENDING' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run(() => prepareEnvelopesAction(settlementId, [key]))}
            >
              {working ? <LoaderCircleIcon className="animate-spin" /> : <PackageCheckIcon />}
              Preparar
            </Button>
          ) : null}
          {canHandle && envelope.status === 'PREPARED' && mode !== 'deliver' ? (
            <Button size="sm" disabled={busy !== null} onClick={() => setMode('deliver')}>
              <HandCoinsIcon />
              Entregar
            </Button>
          ) : null}
          {canHandle && envelope.status === 'PREPARED' && mode === 'none' ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={busy !== null}
              onClick={() => setMode('undo')}
            >
              Deshacer preparación
            </Button>
          ) : null}
          {canRevert && envelope.status === 'DELIVERED' && mode === 'none' ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={busy !== null}
              onClick={() => setMode('revert')}
            >
              <Undo2Icon />
              Revertir entrega
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => setHistory((value) => !value)}
            aria-expanded={history}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Historial
            {history ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </button>
        </div>
      ) : null}

      {mode === 'deliver' ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            ¿Le entregaste <strong className="tabular">{formatMoney(net)}</strong> a {envelope.name}
            ? Queda registrado con tu nombre y la hora.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setMode('none')} disabled={working}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => void run(() => deliverEnvelopeAction(key))}
              disabled={working}
            >
              {working ? <LoaderCircleIcon className="animate-spin" /> : <CheckCircle2Icon />}
              Confirmar entrega
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'undo' || mode === 'revert' ? (
        <div className="mt-3 space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p>
            {mode === 'revert'
              ? 'Revertir la entrega: el sobre vuelve a Preparado. La entrega original queda en el historial.'
              : 'Deshacer la preparación: el sobre vuelve a Pendiente.'}
          </p>
          <Input
            aria-label="Motivo"
            placeholder={`Motivo (mínimo ${MIN_REASON_LENGTH} caracteres)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMode('none');
                setReason('');
              }}
              disabled={working}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reasonOk || working}
              onClick={() =>
                void run(() =>
                  mode === 'revert'
                    ? revertDeliveryAction(key, reason)
                    : undoPreparationAction(key, reason),
                )
              }
            >
              {working ? <LoaderCircleIcon className="animate-spin" /> : null}
              {mode === 'revert' ? 'Revertir entrega' : 'Deshacer preparación'}
            </Button>
          </div>
        </div>
      ) : null}

      {history ? (
        <ol className="mt-3 space-y-1 border-l pl-3 text-xs text-muted-foreground">
          {envelope.events.map((event, index) => (
            <li key={`${event.type}-${event.at}-${index}`}>
              <span className="font-medium text-foreground">{EVENT_LABEL[event.type]}</span> ·{' '}
              {when(event.at)} · {event.by}
              {event.reason ? ` · motivo: ${event.reason}` : ''}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}
