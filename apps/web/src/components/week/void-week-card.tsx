'use client';

import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MIN_REASON_LENGTH } from '@/lib/demo-store/envelopes';
import type { Venue, Week } from '@/lib/demo-store/model';
import { voidBlocker, voidWeek } from '@/lib/demo-store/revisions';
import { useDemoStore } from '@/lib/demo-store/store';

/**
 * Anular el cierre para corregir la semana (regla de DATABASE.md): solo sin sobres entregados,
 * con motivo. La semana vuelve a quedar abierta y el cierre anulado queda en el historial.
 */
export function VoidWeekCard({ venue, week }: { venue: Venue; week: Week }) {
  const { apply, perms, viewAs } = useDemoStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!perms.closeWeek) return null;
  const blocker = voidBlocker(venue, week);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const failure = apply((v) =>
      voidWeek(v, week.id, viewAs?.name ?? 'Encargado', new Date().toISOString(), reason),
    );
    if (failure) {
      setError(failure);
      return;
    }
    router.push('/semana');
  }

  return (
    <div className="mt-6 rounded-xl border border-dashed border-destructive/40 p-4 text-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangleIcon className="size-4 text-destructive" />
            ¿Hay un error en esta semana?
          </p>
          <p className="mt-1 text-muted-foreground">
            Se puede anular el cierre y corregirla: la semana vuelve a quedar abierta, los sobres de
            este cierre se anulan y al volver a cerrarla se calculan de nuevo. El cierre anulado
            queda guardado.
          </p>
          {blocker ? <p className="mt-2 font-medium text-warning-foreground">{blocker}</p> : null}
        </div>
        {!open ? (
          <Button
            variant="outline"
            className="shrink-0"
            disabled={blocker !== null}
            onClick={() => setOpen(true)}
          >
            <RotateCcwIcon />
            Anular semana
          </Button>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Motivo para anular la semana"
            placeholder={`Motivo (mínimo ${MIN_REASON_LENGTH} caracteres)`}
            className="min-w-0 flex-1"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={reason.trim().length < MIN_REASON_LENGTH}
            >
              Anular y reabrir
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
