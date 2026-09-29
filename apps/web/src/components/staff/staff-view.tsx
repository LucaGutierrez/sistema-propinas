'use client';

import { BriefcaseIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { PositionBadge, toneOf } from '@/components/gutip/badges';
import { LoadingState } from '@/components/gutip/loading';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { methodUses } from '@/lib/distribution/participation';
import { formatPortion } from '@/lib/policy/portion-format';
import type { StaffActions, StaffMemberView, StaffView as StaffViewModel } from '@/lib/staff/view';
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

/** Porción del puesto en el formato del restaurante ("0,022" o "2,2 %"). */
function portionOf(view: StaffViewModel, factor: string): string {
  return formatPortion(factor, view.portionDisplay ?? 'DECIMAL');
}

/** ¿Los puntos individuales intervienen en el método vigente? */
function pointsCount(view: StaffViewModel): boolean {
  return view.method !== undefined && methodUses(view.method).points;
}

/**
 * "Personal": quiénes trabajan y en qué puesto. No sabe de dónde vienen los datos: la demo y la
 * base arman el mismo `StaffView` y ofrecen las mismas acciones.
 */
export function StaffView({
  view,
  actions,
}: {
  view: StaffViewModel | null;
  actions: StaffActions;
}) {
  if (!view) return <LoadingState />;
  const active = view.members.filter((member) => member.active);
  const inactive = view.members.filter((member) => !member.active);

  return (
    <>
      <PageHeader
        title="Personal"
        description="Quiénes trabajan, en qué puesto y con cuántos puntos. Agregar, dar de baja o cambiar el puesto o los puntos de alguien no cambia la política."
      />

      {actions.setPoints ? <PointsNotice view={view} /> : null}

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
                Todavía no hay personal en {view.venueName}. Agregá a la primera persona con el
                formulario.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {active.map((member) => (
                  <StaffRow key={member.id} view={view} member={member} actions={actions} />
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
                  <StaffRow key={member.id} view={view} member={member} actions={actions} />
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {view.canEdit ? <AddStaffForm view={view} actions={actions} /> : null}
          <PositionsCard view={view} />
        </div>
      </div>
    </>
  );
}

function StaffRow({
  view,
  member,
  actions,
}: {
  view: StaffViewModel;
  member: StaffMemberView;
  actions: StaffActions;
}) {
  const [editing, setEditing] = useState(false);
  const [editingPoints, setEditingPoints] = useState(false);
  const [points, setPoints] = useState(member.individualPoints ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const position = view.positions.find((p) => p.id === member.positionId);
  const canEdit = view.canEdit;

  function run(action: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      const failure = await action();
      if (failure) setError(failure);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Initials name={member.name} muted={!member.active} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', !member.active && 'text-muted-foreground')}>
          {member.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Porción {position ? portionOf(view, position.factor) : '—'}
          {member.individualPoints !== undefined ? (
            <>
              {' · '}
              {member.individualPoints} {member.individualPoints === '1,00' ? 'punto' : 'puntos'}
              {pointsCount(view) ? null : ' (no se usan con el método vigente)'}
            </>
          ) : null}
        </p>
        {editingPoints && actions.setPoints ? (
          <form
            className="mt-1 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const savePoints = actions.setPoints;
              if (!savePoints) return;
              setEditingPoints(false);
              run(() => savePoints(member.id, points));
            }}
          >
            <Input
              aria-label={`Puntos de ${member.name}`}
              inputMode="decimal"
              className="tabular h-8 w-24 text-right"
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={pending}>
              Guardar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingPoints(false);
                setPoints(member.individualPoints ?? '');
              }}
            >
              Cancelar
            </Button>
          </form>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {editing ? (
        <select
          aria-label={`Puesto de ${member.name}`}
          className={cn(SELECT_CLASS, 'w-40')}
          value={member.positionId}
          onChange={(event) => {
            const positionId = event.target.value;
            setEditing(false);
            run(() => actions.setPosition(member.id, positionId));
          }}
          onBlur={() => setEditing(false)}
          autoFocus
        >
          {position ? null : <option value={member.positionId}>Sin puesto</option>}
          {view.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({portionOf(view, p.factor)})
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label={`Cambiar el puesto de ${member.name}`}
          disabled={!member.active || !canEdit || pending}
        >
          <PositionBadge
            name={position?.name ?? ''}
            tone={toneOf(view.positions, member.positionId)}
          />
        </button>
      )}
      {canEdit && member.active && actions.setPoints && !editingPoints ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`Cambiar los puntos de ${member.name}`}
          onClick={() => {
            setPoints(member.individualPoints ?? '');
            setEditingPoints(true);
          }}
        >
          Puntos
        </Button>
      ) : null}
      {!canEdit ? null : member.active ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={pending}
          onClick={() => run(() => actions.setActive(member.id, false))}
        >
          Dar de baja
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => actions.setActive(member.id, true))}
        >
          Reactivar
        </Button>
      )}
    </li>
  );
}

function AddStaffForm({ view, actions }: { view: StaffViewModel; actions: StaffActions }) {
  const [name, setName] = useState('');
  const [chosenPositionId, setPositionId] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // Si todavía no se eligió (o el local no tenía puestos al abrir), se usa el primero.
  const positionId = view.positions.some((p) => p.id === chosenPositionId)
    ? chosenPositionId
    : (view.positions[0]?.id ?? '');
  const noPositions = view.positions.length === 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const added = name.trim();
    startTransition(async () => {
      const error = await actions.add(name, positionId);
      if (error) {
        setMessage({ error: true, text: error });
        return;
      }
      setMessage({ error: false, text: `${added} se agregó al equipo.` });
      setName('');
    });
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
              {view.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (porción {portionOf(view, p.factor)})
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
          <Button type="submit" className="w-full" disabled={pending}>
            <UserPlusIcon />
            {pending ? 'Agregando…' : 'Agregar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Los puestos y sus porciones son parte de la política: acá solo se muestran. */
function PositionsCard({ view }: { view: StaffViewModel }) {
  const positions = view.positions;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BriefcaseIcon className="size-4 text-primary" />
          Puestos
        </CardTitle>
        <CardDescription>
          Los puestos y sus porciones son parte de la política de distribución (versión{' '}
          {view.policyVersion}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {positions.map((position) => {
            const people = view.members.filter(
              (s) => s.active && s.positionId === position.id,
            ).length;
            return (
              <li key={position.id} className="flex items-center justify-between gap-2 text-sm">
                <PositionBadge name={position.name} tone={toneOf(positions, position.id)} />
                <span className="tabular text-muted-foreground">
                  porción {portionOf(view, position.factor)} · {people}{' '}
                  {people === 1 ? 'persona' : 'personas'}
                </span>
              </li>
            );
          })}
        </ul>
        <Button asChild variant="outline" className="w-full">
          <Link href="/configuracion">Editar puestos y porciones</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const METHOD_TEXT = {
  BY_POSITION:
    'El método vigente es "Por puesto": se reparte por horas × porción del puesto. Los puntos se guardan pero no intervienen hasta que el método los use.',
  BY_POINTS:
    'El método vigente es "Por puntos individuales": se reparte por horas × puntos de cada persona. La porción del puesto no interviene.',
  BY_POSITION_TIMES_POINTS:
    'El método vigente es "Puesto × puntos": se reparte por horas × porción del puesto × puntos de cada persona.',
} as const;

/** Qué es cada cosa: Porción = factor del puesto (política) · Puntos = de cada persona. */
function PointsNotice({ view }: { view: StaffViewModel }) {
  return (
    <div className="mb-6 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Porción</span> = factor del puesto (se define
        en Configuración y es parte de la política).{' '}
        <span className="font-medium text-foreground">Puntos</span> = puntos individuales de cada
        persona (se definen acá; 1,00 por defecto). Cambiar los puntos no crea una versión de la
        política ni cambia los repartos ya cerrados.
      </p>
      {view.method ? <p className="mt-1">{METHOD_TEXT[view.method]}</p> : null}
    </div>
  );
}
