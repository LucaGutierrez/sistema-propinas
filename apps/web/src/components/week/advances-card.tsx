'use client';

import { HandCoinsIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDayMonth, formatWeekday, todayIso, weekDays } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import { addAdvance, voidAdvance } from '@/lib/demo-store/advances';
import { MIN_REASON_LENGTH } from '@/lib/demo-store/envelopes';
import { activeAdvances, type AdvanceEntry, type Venue, type Week } from '@/lib/demo-store/model';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import { cn } from '@/lib/utils';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 md:text-sm';

const WHEN = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const when = (iso?: string) => (iso ? WHEN.format(new Date(iso)) : '');

/** Adelantos de una semana: registro con altas y anulaciones (con motivo). */
export function AdvancesCard({
  venue,
  week,
  className,
}: {
  venue: Venue;
  week: Week;
  className?: string;
}) {
  const { perms } = useDemoStore();
  const canEdit = week.status === 'ABIERTA' && perms.editWeek;
  const active = activeAdvances(week);
  const total = active.reduce((sum, entry) => sum + BigInt(entry.amountCents), 0n);
  const nameOf = (staffId: string) => venue.staff.find((s) => s.id === staffId)?.name ?? staffId;
  const entries = [...week.advanceEntries].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date < b.date ? -1 : 1,
  );

  return (
    <Card className={cn('gap-0 pb-0', className)}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <HandCoinsIcon className="size-4 text-primary" />
          Adelantos de la semana
        </CardTitle>
        <CardDescription>
          Cada adelanto queda registrado con fecha y quién lo cargó; no se borra, se anula.
          Provisional (P6): se descuentan todos del sobre de esta semana.
        </CardDescription>
        <CardAction>
          <span className="tabular text-lg font-semibold">{formatMoney(total)}</span>
        </CardAction>
      </CardHeader>

      {entries.length === 0 ? (
        <p className="border-t px-5 py-6 text-center text-sm text-muted-foreground">
          No hay adelantos en esta semana.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {entries.map((entry) => (
            <AdvanceRow
              key={entry.id}
              week={week}
              entry={entry}
              name={nameOf(entry.staffId)}
              canVoid={canEdit}
            />
          ))}
        </ul>
      )}

      {canEdit ? <AddAdvanceForm venue={venue} week={week} /> : null}
    </Card>
  );
}

function AdvanceRow({
  week,
  entry,
  name,
  canVoid,
}: {
  week: Week;
  entry: AdvanceEntry;
  name: string;
  canVoid: boolean;
}) {
  const { apply, viewAs } = useDemoStore();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const voided = Boolean(entry.voidedAt);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const failure = apply((v) =>
      voidAdvance(
        v,
        week.id,
        entry.id,
        viewAs?.name ?? 'Encargado',
        new Date().toISOString(),
        reason,
      ),
    );
    setError(failure);
    if (!failure) setVoiding(false);
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-24 shrink-0 text-sm capitalize">
          {formatWeekday(entry.date)}{' '}
          <span className="text-muted-foreground">{formatDayMonth(entry.date)}</span>
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-medium',
            voided && 'text-muted-foreground line-through',
          )}
        >
          {name}
        </span>
        {entry.origin === 'SALDO_ANTERIOR' ? <Badge variant="warning">Saldo anterior</Badge> : null}
        {voided ? (
          <Badge variant="outline" className="text-muted-foreground">
            Anulado
          </Badge>
        ) : null}
        <span
          className={cn('tabular font-semibold', voided && 'text-muted-foreground line-through')}
        >
          {formatMoney(BigInt(entry.amountCents))}
        </span>
        {canVoid && !voided && !voiding ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setVoiding(true)}
          >
            Anular
          </Button>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {entry.note ? `${entry.note} · ` : ''}cargado por {entry.createdBy} el{' '}
        {when(entry.createdAt)}
        {voided
          ? ` · anulado por ${entry.voidedBy} el ${when(entry.voidedAt)}: ${entry.voidReason}`
          : ''}
      </p>

      {voiding ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2">
          <Input
            aria-label={`Motivo para anular el adelanto de ${name}`}
            placeholder={`Motivo (mínimo ${MIN_REASON_LENGTH} caracteres)`}
            className="min-w-0 flex-1"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            autoFocus
          />
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={reason.trim().length < MIN_REASON_LENGTH}
          >
            Anular adelanto
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setVoiding(false)}>
            Cancelar
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddAdvanceForm({ venue, week }: { venue: Venue; week: Week }) {
  const { apply, viewAs } = useDemoStore();
  const days = weekDays(week.startDate);
  const today = todayIso();
  const activeStaff = venue.staff.filter((s) => s.active);
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(days.includes(today) ? today : (days[0] ?? ''));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const person = activeStaff.find((s) => s.id === staffId);
    const error = apply((v) =>
      addAdvance(v, week.id, {
        id: newId('adelanto'),
        staffId,
        date,
        amount,
        note,
        by: viewAs?.name ?? 'Encargado',
        at: new Date().toISOString(),
      }),
    );
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    setMessage({ error: false, text: `Adelanto de ${person?.name ?? ''} registrado.` });
    setAmount('');
    setNote('');
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t bg-muted/30 px-5 py-4">
      <p className="text-sm font-medium">Registrar adelanto</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="adelanto-persona">Persona</Label>
          <select
            id="adelanto-persona"
            className={SELECT_CLASS}
            value={staffId}
            onChange={(event) => {
              setStaffId(event.target.value);
              setMessage(null);
            }}
          >
            <option value="">Elegí…</option>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adelanto-fecha">Fecha</Label>
          <select
            id="adelanto-fecha"
            className={cn(SELECT_CLASS, 'capitalize')}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          >
            {days.map((day) => (
              <option key={day} value={day}>
                {formatWeekday(day)} {formatDayMonth(day)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adelanto-monto">Monto</Label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="adelanto-monto"
              inputMode="decimal"
              className="tabular pl-7 text-right"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setMessage(null);
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adelanto-nota">Nota (opcional)</Label>
          <Input
            id="adelanto-nota"
            value={note}
            placeholder="Ej.: pidió para el alquiler"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm">
          <PlusIcon />
          Registrar adelanto
        </Button>
        {message ? (
          <p
            role={message.error ? 'alert' : 'status'}
            className={cn('text-sm', message.error ? 'text-destructive' : 'text-primary')}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
