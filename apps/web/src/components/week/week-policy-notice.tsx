'use client';

import { AlertTriangleIcon, SlidersHorizontalIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MIN_REASON_LENGTH } from '@/lib/demo-store/envelopes';
import { weekPolicy, type Venue, type Week } from '@/lib/demo-store/model';
import { policyGaps } from '@/lib/demo-store/policy';
import { repinWeek } from '@/lib/demo-store/policy-ops';
import { useDemoStore } from '@/lib/demo-store/store';

const WHEN = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Qué versión de la política usa la semana abierta, si hay algo por definir (bloquea el cierre)
 * y, en una semana reabierta con otra versión vigente, la opción explícita de cambiarla.
 */
export function WeekPolicyNotice({ venue, week }: { venue: Venue; week: Week }) {
  const { apply, perms, viewAs } = useDemoStore();
  const [switching, setSwitching] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const policy = weekPolicy(venue, week);
  const current = venue.policy.current;
  const gaps = policyGaps(policy);
  const lastChange = week.policyLog?.[week.policyLog.length - 1];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const failure = apply((v) =>
      repinWeek(v, week.id, current, viewAs?.name ?? 'Encargado', new Date().toISOString(), reason),
    );
    setError(failure);
    if (!failure) {
      setSwitching(false);
      setReason('');
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <SlidersHorizontalIcon className="size-4" />
        <span>
          Se calcula con la política{' '}
          <strong className="text-foreground">versión {policy.number}</strong>
          {policy.number === current ? ' (la vigente)' : ''}.
        </span>
        {lastChange ? (
          <span>
            Pasó de la versión {lastChange.from} a la {lastChange.to} el{' '}
            {WHEN.format(new Date(lastChange.at))}
            {lastChange.automatic ? ' al cambiar la política' : ` (${lastChange.reason})`}.
          </span>
        ) : null}
        <Link href="/configuracion" className="text-primary hover:underline">
          Ver configuración
        </Link>
      </p>

      {policy.number !== current ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p>
            Esta semana fue reabierta y conserva la versión {policy.number} de la política, con la
            que se calculó originalmente. La vigente es la versión {current}.
          </p>
          {perms.closeWeek && !switching ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 border-sky-300 bg-white"
              onClick={() => setSwitching(true)}
            >
              Usar la versión {current}
            </Button>
          ) : null}
          {switching ? (
            <form onSubmit={submit} className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Motivo para cambiar la versión de la política"
                placeholder={`Motivo (mínimo ${MIN_REASON_LENGTH} caracteres)`}
                className="min-w-0 flex-1 bg-white"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setError(null);
                }}
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={reason.trim().length < MIN_REASON_LENGTH}>
                  Cambiar a la versión {current}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSwitching(false)}>
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
      ) : null}

      {gaps.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangleIcon className="size-4" />
            La política tiene puntos por definir: se puede calcular la vista previa, pero no cerrar.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
