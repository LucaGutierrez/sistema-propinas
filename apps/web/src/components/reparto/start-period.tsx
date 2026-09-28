'use client';

import { CalendarDaysIcon, LoaderCircleIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startPeriodAction } from '@/app/reparto/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { addDays, formatDayMonth, formatShortDate } from '@/lib/dates';

/**
 * Empezar un reparto: se elige la semana (la actual o la anterior, que es lo más común el lunes)
 * y se abre la pantalla de carga. La semana exacta la ajusta el servidor al día de inicio de la
 * configuración del restaurante.
 */
export function StartPeriod({
  currentStart,
  activePeople,
  canEdit,
}: {
  currentStart: string;
  activePeople: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const previousStart = addDays(currentStart, -7);
  const [choice, setChoice] = useState<string>(currentStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await startPeriodAction(choice).catch(() => ({
      ok: false as const,
      error: 'No se pudo empezar. Revisá tu conexión y probá de nuevo.',
    }));
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const option = (start: string, label: string) => (
    <label
      key={start}
      className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
    >
      <input
        type="radio"
        name="week"
        value={start}
        checked={choice === start}
        onChange={() => setChoice(start)}
        className="accent-[var(--color-primary)]"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">
          Del {formatDayMonth(start)} al {formatShortDate(addDays(start, 6))}
        </span>
      </span>
    </label>
  );

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarDaysIcon className="size-5" />
        </div>
        <CardTitle>Repartir las propinas de una semana</CardTitle>
        <CardDescription>
          Cargás cuánta propina se juntó y cuántas horas trabajó cada persona. GUTIP calcula cuánto
          le toca a cada uno; revisás y cerrás el reparto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activePeople === 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p>Primero cargá a tu equipo: para repartir hace falta al menos una persona.</p>
            <Button asChild size="sm" className="mt-2">
              <Link href="/personal">
                <UserPlusIcon />
                Agregar personal
              </Link>
            </Button>
          </div>
        ) : null}
        {canEdit ? (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">¿Qué semana vas a repartir?</legend>
              {option(currentStart, 'Esta semana')}
              {option(previousStart, 'La semana pasada')}
            </fieldset>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button className="w-full" size="lg" onClick={() => void start()} disabled={busy}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
              Empezar reparto
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay ningún reparto abierto. Tu rol puede ver los repartos, pero no empezarlos.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
