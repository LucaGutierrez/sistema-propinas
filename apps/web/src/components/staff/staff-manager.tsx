'use client';

import { BriefcaseIcon, UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { PositionBadge, toneOf } from '@/components/gutip/badges';
import { LoadingState } from '@/components/gutip/loading';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  addPosition,
  addStaff,
  setStaffActive,
  setStaffPosition,
  type Venue,
  type Staff,
} from '@/lib/demo-store/model';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import { cn } from '@/lib/utils';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 md:text-sm';

function Initials({ name, muted }: { name: string; muted?: boolean }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        muted ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground',
      )}
    >
      {initials}
    </span>
  );
}

export function StaffManager() {
  const { venue, perms } = useDemoStore();
  if (!venue) return <LoadingState />;
  const active = venue.staff.filter((member) => member.active);
  const inactive = venue.staff.filter((member) => !member.active);

  return (
    <>
      <PageHeader
        title="Personal"
        description="Quién participa del reparto, su puesto y el factor de cada puesto."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-4">
              <CardTitle>Equipo</CardTitle>
              <CardDescription>
                {active.length} {active.length === 1 ? 'persona activa' : 'personas activas'}
              </CardDescription>
            </CardHeader>
            {active.length === 0 ? (
              <p className="border-t px-5 py-8 text-center text-sm text-muted-foreground">
                Todavía no hay personal en {venue.name}. Agregá a la primera persona con el
                formulario.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {active.map((member) => (
                  <StaffRow key={member.id} venue={venue} member={member} />
                ))}
              </ul>
            )}
          </Card>

          {inactive.length > 0 ? (
            <Card className="gap-0 pb-0">
              <CardHeader className="pb-4">
                <CardTitle>De baja</CardTitle>
                <CardDescription>
                  No entran en el reparto. Siguen apareciendo en las semanas ya cerradas.
                </CardDescription>
              </CardHeader>
              <ul className="divide-y border-t">
                {inactive.map((member) => (
                  <StaffRow key={member.id} venue={venue} member={member} />
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {perms.manageStaff ? <AddStaffForm venue={venue} /> : null}
          <PositionsCard venue={venue} />
        </div>
      </div>
    </>
  );
}

function StaffRow({ venue, member }: { venue: Venue; member: Staff }) {
  const { apply, perms } = useDemoStore();
  const [editing, setEditing] = useState(false);
  const position = venue.positions.find((p) => p.id === member.positionId);
  const canEdit = perms.manageStaff;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Initials name={member.name} muted={!member.active} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', !member.active && 'text-muted-foreground')}>
          {member.name}
        </p>
        <p className="text-xs text-muted-foreground">factor {position?.factor ?? '—'}</p>
      </div>
      {editing ? (
        <select
          aria-label={`Puesto de ${member.name}`}
          className={cn(SELECT_CLASS, 'w-40')}
          value={member.positionId}
          onChange={(event) => {
            apply((s) => setStaffPosition(s, member.id, event.target.value));
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          autoFocus
        >
          {venue.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.factor})
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label={`Cambiar el puesto de ${member.name}`}
          disabled={!member.active || !canEdit}
        >
          <PositionBadge
            name={position?.name ?? ''}
            tone={toneOf(venue.positions, member.positionId)}
          />
        </button>
      )}
      {!canEdit ? null : member.active ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => apply((s) => setStaffActive(s, member.id, false))}
        >
          Dar de baja
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => apply((s) => setStaffActive(s, member.id, true))}
        >
          Reactivar
        </Button>
      )}
    </li>
  );
}

function AddStaffForm({ venue }: { venue: Venue }) {
  const { apply } = useDemoStore();
  const [name, setName] = useState('');
  const [chosenPositionId, setPositionId] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  // Si todavía no se eligió (o el local no tenía puestos al abrir), se usa el primero.
  const positionId = venue.positions.some((p) => p.id === chosenPositionId)
    ? chosenPositionId
    : (venue.positions[0]?.id ?? '');
  const noPositions = venue.positions.length === 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const error = apply((s) => addStaff(s, { id: newId('persona'), name, positionId }));
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    setMessage({ error: false, text: `${name.trim()} se agregó al equipo.` });
    setName('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlusIcon className="size-4 text-primary" />
          Agregar persona
        </CardTitle>
        <CardDescription>Un camarero nuevo, alguien de cocina, etc.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
              placeholder="Ej.: Sofía"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="puesto">Puesto</Label>
            {noPositions ? (
              <p className="text-sm text-warning-foreground">
                Este local no tiene puestos todavía: creá uno abajo, en Puestos.
              </p>
            ) : null}
            <select
              id="puesto"
              className={SELECT_CLASS}
              value={positionId}
              disabled={noPositions}
              onChange={(event) => setPositionId(event.target.value)}
            >
              {venue.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (factor {p.factor})
                </option>
              ))}
            </select>
          </div>
          {message ? (
            <p
              role={message.error ? 'alert' : 'status'}
              className={cn('text-sm', message.error ? 'text-destructive' : 'text-primary')}
            >
              {message.text}
            </p>
          ) : null}
          <Button type="submit" className="w-full">
            <UserPlusIcon />
            Agregar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PositionsCard({ venue }: { venue: Venue }) {
  const { apply, perms } = useDemoStore();
  const [name, setName] = useState('');
  const [factor, setFactor] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const failure = apply((s) => addPosition(s, { id: newId('puesto'), name, factor }));
    setError(failure);
    if (!failure) {
      setName('');
      setFactor('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BriefcaseIcon className="size-4 text-primary" />
          Puestos
        </CardTitle>
        <CardDescription>El factor define cuánto pesa cada hora de ese puesto.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {venue.positions.map((position) => {
            const people = venue.staff.filter(
              (s) => s.active && s.positionId === position.id,
            ).length;
            return (
              <li key={position.id} className="flex items-center justify-between gap-2 text-sm">
                <PositionBadge name={position.name} tone={toneOf(venue.positions, position.id)} />
                <span className="tabular text-muted-foreground">
                  factor {position.factor} · {people} {people === 1 ? 'persona' : 'personas'}
                </span>
              </li>
            );
          })}
        </ul>
        {perms.manageStaff ? (
          <form onSubmit={submit} className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Nuevo puesto</p>
            <div className="grid grid-cols-5 gap-2">
              <Input
                aria-label="Nombre del puesto"
                className="col-span-3"
                placeholder="Ej.: Cocina"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
              <Input
                aria-label="Factor del puesto"
                className="tabular col-span-2"
                inputMode="decimal"
                placeholder="0,015"
                value={factor}
                onChange={(event) => {
                  setFactor(event.target.value);
                  setError(null);
                }}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="outline" className="w-full">
              Agregar puesto
            </Button>
          </form>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="border-dashed text-muted-foreground">
            Fórmula provisional
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
