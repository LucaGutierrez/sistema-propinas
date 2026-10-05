'use client';

import { HandCoinsIcon, LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addAdvanceAction, voidAdvanceAction } from '@/app/reparto/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { nativeSelectClass } from '@/components/ui/native-select';
import { formatDayMonth, formatWeekday, weekDays } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import type { OpenPeriodView } from '@/lib/distribution/period-view';

/**
 * Adelantos: plata que alguien ya recibió a cuenta de su propina. Se descuentan de lo que le toca
 * al cerrar; lo que no alcanza queda pendiente para el próximo reparto. Nunca se borran: se anulan.
 */
export function AdvancesSection({ view, readOnly }: { view: OpenPeriodView; readOnly: boolean }) {
  const router = useRouter();
  const days = weekDays(view.weekStart);
  const active = view.people.filter((p) => p.active);
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(days[0] ?? view.weekStart);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId) {
      setError('Elegí a la persona.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await addAdvanceAction({
      settlementId: view.settlementId,
      employeeId,
      date,
      amount,
      note,
    }).catch(() => ({ ok: false as const, error: 'No se pudo guardar. Probá de nuevo.' }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAmount('');
    setNote('');
    setOpen(false);
    router.refresh();
  }

  async function confirmVoid(advanceId: string) {
    setBusy(true);
    setError(null);
    const result = await voidAdvanceAction(advanceId, reason).catch(() => ({
      ok: false as const,
      error: 'No se pudo anular. Probá de nuevo.',
    }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVoiding(null);
    setReason('');
    router.refresh();
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoinsIcon className="size-5 text-primary" />
          Adelantos <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
        </CardTitle>
        <CardDescription>
          Si alguien ya recibió plata a cuenta de su propina, registralo: se descuenta de lo que le
          toca.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {view.advances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay adelantos para descontar.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {view.advances.map((a) => (
              <li key={a.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.carried ? 'Pendiente de antes · ' : ''}
                      {formatDayMonth(a.date)}
                      {a.note ? ` · ${a.note}` : ''} · cargado por {a.createdByName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular font-medium">
                      {formatMoney(BigInt(a.balanceCents))}
                    </span>
                    {readOnly || a.balanceCents !== a.amountCents ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => {
                          setVoiding(voiding === a.id ? null : a.id);
                          setReason('');
                        }}
                      >
                        Anular
                      </Button>
                    )}
                  </div>
                </div>
                {voiding === a.id ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Input
                      aria-label="Motivo de la anulación"
                      placeholder="Motivo (p. ej. se cargó dos veces)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void confirmVoid(a.id)}
                    >
                      Confirmar anulación
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {readOnly ? null : open ? (
          <form onSubmit={add} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <div>
              <label htmlFor="advance-person" className="mb-1 block text-xs text-muted-foreground">
                Persona
              </label>
              <select
                id="advance-person"
                className={nativeSelectClass}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Elegí…</option>
                {active.map((p) => (
                  <option key={p.employeeId} value={p.employeeId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="advance-date" className="mb-1 block text-xs text-muted-foreground">
                Día
              </label>
              <select
                id="advance-date"
                className={nativeSelectClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {formatWeekday(d)} {formatDayMonth(d)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="advance-amount" className="mb-1 block text-xs text-muted-foreground">
                Monto
              </label>
              <Input
                id="advance-amount"
                inputMode="decimal"
                placeholder="$ 0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="advance-note" className="mb-1 block text-xs text-muted-foreground">
                Nota (opcional)
              </label>
              <Input id="advance-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
                Registrar adelanto
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setOpen(true)} disabled={active.length === 0}>
            Registrar un adelanto
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
