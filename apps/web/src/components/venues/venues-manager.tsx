'use client';

import { ArrowRightIcon, CheckIcon, PencilIcon, PlusIcon, StoreIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { WeekStatusBadge } from '@/components/gutip/badges';
import { LoadingState } from '@/components/gutip/loading';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMonth, formatWeekRange, todayIso } from '@/lib/dates';
import { formatMoneyShort } from '@/lib/decimal';
import { monthlySummary, openWeek, weekTotal, type Venue } from '@/lib/demo-store/model';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import { createVenue, renameVenue, setActiveVenue } from '@/lib/demo-store/workspace';
import { cn } from '@/lib/utils';

export function VenuesManager() {
  const { workspace } = useDemoStore();
  if (!workspace) return <LoadingState />;
  const thisMonth = todayIso().slice(0, 7);

  return (
    <>
      <PageHeader
        title="Mis locales"
        description="Cada local tiene su propio personal, semanas y sobres. Nada se mezcla entre locales."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="grid grid-cols-1 content-start gap-4 md:grid-cols-2 xl:col-span-2">
          {workspace.venues.map((venue) => (
            <VenueCard
              key={venue.id}
              venue={venue}
              active={venue.id === workspace.activeVenueId}
              month={thisMonth}
            />
          ))}
        </div>
        <NewVenueForm />
      </div>
    </>
  );
}

function VenueCard({ venue, active, month }: { venue: Venue; active: boolean; month: string }) {
  const { applyWorkspace } = useDemoStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(venue.name);
  const [error, setError] = useState<string | null>(null);

  const current = openWeek(venue);
  const monthCents = monthlySummary(venue).find((m) => m.month === month)?.generatedCents ?? 0n;
  const staffCount = venue.staff.filter((s) => s.active).length;

  function saveName(event: React.FormEvent) {
    event.preventDefault();
    const failure = applyWorkspace((ws) => renameVenue(ws, venue.id, name));
    setError(failure);
    if (!failure) setEditing(false);
  }

  return (
    <Card className={cn('gap-4', active && 'border-primary/40 ring-1 ring-primary/20')}>
      <CardHeader>
        {editing ? (
          <form onSubmit={saveName} className="flex items-center gap-2">
            <Input
              aria-label="Nombre del local"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              autoFocus
            />
            <Button type="submit" size="icon" aria-label="Guardar nombre">
              <CheckIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancelar"
              onClick={() => {
                setEditing(false);
                setName(venue.name);
                setError(null);
              }}
            >
              <XIcon />
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <StoreIcon className="size-4" />
            </div>
            <CardTitle className="min-w-0 flex-1 truncate text-lg">{venue.name}</CardTitle>
            {active ? <Badge variant="success">Activo</Badge> : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={`Renombrar ${venue.name}`}
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
            </Button>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="tabular grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Personal</dt>
            <dd className="font-medium">{staffCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Pozo semana</dt>
            <dd className="font-medium">
              {current ? formatMoneyShort(weekTotal(current).totalCents) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{formatMonth(month).split(' ')[0]}</dt>
            <dd className="font-medium">{formatMoneyShort(monthCents)}</dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-2 text-sm">
          {current ? (
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <WeekStatusBadge status="ABIERTA" />
              <span className="truncate">{formatWeekRange(current.startDate)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Sin semana abierta</span>
          )}
          {active ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                Ir al inicio
                <ArrowRightIcon />
              </Link>
            </Button>
          ) : (
            <Button size="sm" onClick={() => applyWorkspace((ws) => setActiveVenue(ws, venue.id))}>
              Entrar
              <ArrowRightIcon />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NewVenueForm() {
  const { workspace, venue, applyWorkspace } = useDemoStore();
  const [name, setName] = useState('');
  const [copyPositions, setCopyPositions] = useState(true);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  if (!workspace || !venue) return null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const error = applyWorkspace((ws) =>
      createVenue(ws, {
        id: newId('local'),
        name,
        copyPositionsFrom: copyPositions ? ws.activeVenueId : null,
      }),
    );
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    setMessage({ error: false, text: `Se creó "${trimmed}" y quedó como local activo.` });
    setName('');
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusIcon className="size-4 text-primary" />
          Nuevo local
        </CardTitle>
        <CardDescription>
          Por ejemplo "Faena Mercado". Empieza sin personal ni semanas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nombre-local">Nombre del local</Label>
            <Input
              id="nombre-local"
              value={name}
              placeholder="Ej.: Faena Mercado"
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
            />
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={copyPositions}
              onChange={(event) => setCopyPositions(event.target.checked)}
            />
            <span>
              Copiar los puestos y factores de <strong>{venue.name}</strong>
              <span className="block text-xs text-muted-foreground">
                El personal no se copia: cada local tiene el suyo.
              </span>
            </span>
          </label>
          {message ? (
            <p
              role={message.error ? 'alert' : 'status'}
              className={cn('text-sm', message.error ? 'text-destructive' : 'text-primary')}
            >
              {message.text}
            </p>
          ) : null}
          <Button type="submit" className="w-full">
            <PlusIcon />
            Crear local
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
