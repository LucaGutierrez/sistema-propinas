'use client';

import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CheckIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, useTransition } from 'react';
import { SectorBreakdown } from '@/components/distribution/sector-breakdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney, parseMoney } from '@/lib/decimal';
import { stepsToView, type SectorsSummary } from '@/lib/distribution/sector-snapshot';
import {
  checkSectors,
  computeSectors,
  formatSectorPercent,
  isLegacySectors,
  MAX_SECTORS,
  parseSectorPercent,
  partialSectors,
  type SectorBase,
  type SectorInput,
} from '@/lib/distribution/sector-steps';
import { STAGED_GROUPS } from '@/lib/policy/changes';
import type { DistributionConfigActions, DistributionConfigView } from '@/lib/policy/view';
import { cn } from '@/lib/utils';

const EXAMPLE_DEFAULT = '100.000';

interface Row {
  /** Identidad local (estable mientras se edita; no es el id de la base). */
  key: string;
  name: string;
  base: SectorBase;
  percent: string;
  positionIds: string[];
}

type Positions = DistributionConfigView['current']['positions'];

let nextKey = 0;
const newKey = () => `s${(nextKey += 1)}`;

/** Lo guardado en la versión vigente (o, en una versión del formato anterior, sus etapas). */
function savedRows(version: DistributionConfigView['current']): Row[] {
  const sectors = version.sectors ?? [];
  if (sectors.length > 0) {
    return sectors.map((s) => ({
      key: newKey(),
      name: s.name,
      base: s.base,
      percent: s.percent,
      positionIds: version.positions.filter((p) => p.sectorId === s.id).map((p) => p.id),
    }));
  }
  if (isLegacySectors(sectors, version.positions)) {
    // Punto de partida para revisar: cada puesto con etapa pasa a ser un sector.
    return [...version.positions]
      .filter((p) => p.stage)
      .sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0))
      .map((p) => ({
        key: newKey(),
        name: p.name,
        base: p.stage === 1 ? 'TOTAL' : 'REMAINDER',
        percent: p.stagePercent ?? '',
        positionIds: [p.id],
      }));
  }
  return [];
}

/** Ejemplo para empezar: Cocina 30 % del total, Salón 50 % del saldo y Bacha el resto. */
function exampleRows(positions: Positions): Row[] {
  const named = (name: string) =>
    positions.filter((p) => p.name.trim().toLowerCase() === name).map((p) => p.id);
  const kitchen = named('cocina');
  const dish = named('bacha');
  const floor = positions
    .map((p) => p.id)
    .filter((id) => !kitchen.includes(id) && !dish.includes(id));
  return [
    { key: newKey(), name: 'Cocina', base: 'TOTAL', percent: '30', positionIds: kitchen },
    { key: newKey(), name: 'Salón', base: 'REMAINDER', percent: '50', positionIds: floor },
    { key: newKey(), name: 'Bacha', base: 'REMAINDER', percent: '100', positionIds: dish },
  ];
}

const comparable = (rows: readonly Row[]) =>
  JSON.stringify(
    rows.map((r, i) => [
      r.name.trim(),
      i === 0 ? 'TOTAL' : r.base,
      String(parseSectorPercent(r.percent)),
      [...r.positionIds].sort(),
    ]),
  );

/**
 * "Reparto por sectores": los sectores en el orden en que se reparte la propina. Cada uno tiene
 * nombre, porcentaje, base (el total o el saldo que queda) y los puestos cuya gente cobra de él
 * (ninguno = el sector cobra entero). Lo de adentro de cada sector se reparte con lo que ya está en
 * "Puestos y porciones" y "Personal": acá no se vuelve a cargar.
 *
 * Pensado primero para el celular: un paso por tarjeta, campos de 44 px, la cuenta en pesos de
 * cada paso debajo de sus campos y el resumen completo con un monto de prueba.
 */
export function SectorStepsEditor({
  view,
  canEdit,
  actions,
}: {
  view: DistributionConfigView;
  canEdit: boolean;
  actions: DistributionConfigActions;
}) {
  const version = view.current;
  const positions = version.positions;
  const active = version.values.groups === STAGED_GROUPS;
  const legacy = active && isLegacySectors(version.sectors, positions);
  const [rows, setRows] = useState<Row[]>(() => savedRows(version));
  const [saved0, setSaved0] = useState(() => comparable(savedRows(version)));
  const [example, setExample] = useState(EXAMPLE_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // Una versión nueva (de otro cambio o de este) vuelve a cargar lo guardado.
  const [seenVersion, setSeenVersion] = useState(version.number);
  if (seenVersion !== version.number) {
    setSeenVersion(version.number);
    const fresh = savedRows(version);
    setRows(fresh);
    setSaved0(comparable(fresh));
  }

  const inputs: SectorInput[] = rows.map((r, index) => ({
    id: r.key,
    name: r.name,
    base: index === 0 ? 'TOTAL' : r.base,
    percent: r.percent.trim() === '' ? null : r.percent,
    positionIds: r.positionIds,
  }));
  const check = checkSectors(inputs, positions);
  const exampleCents = parseMoney(example);
  const exampleOk = exampleCents !== null && exampleCents > 0n;
  // Resumen en vivo: exacto con la configuración completa; mientras tanto, los primeros pasos
  // que ya se pueden calcular (lo demás queda "todavía sin repartir").
  const plan = check.ok ? check.sectors : partialSectors(inputs);
  const names = new Map(positions.map((p) => [p.id, p.name]));
  const results = exampleOk && plan.length > 0 ? computeSectors(exampleCents, plan) : [];
  const live = new Map(results.map((r) => [r.id, r]));
  const summary: SectorsSummary | null =
    exampleOk && rows.length > 0
      ? {
          kind: 'steps',
          ...stepsToView(exampleCents, results, (id) => names.get(id) ?? '—', new Map()),
        }
      : null;
  const dirty = comparable(rows) !== saved0 || legacy;
  const owner = new Map(rows.flatMap((r) => r.positionIds.map((id) => [id, r] as const)));
  const outside = positions.filter((p) => !owner.has(p.id));

  function change(next: Row[]) {
    setSaved(false);
    setError(null);
    setRows(next);
  }
  const update = (key: string, patch: Partial<Row>) =>
    change(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  /** Un puesto va en un solo sector: elegirlo acá lo saca de donde estaba. */
  const togglePosition = (key: string, positionId: string) =>
    change(
      rows.map((r) =>
        r.key === key
          ? {
              ...r,
              positionIds: r.positionIds.includes(positionId)
                ? r.positionIds.filter((id) => id !== positionId)
                : [...r.positionIds, positionId],
            }
          : { ...r, positionIds: r.positionIds.filter((id) => id !== positionId) },
      ),
    );
  const move = (index: number, delta: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + delta, 0, row);
    change(next);
  };
  const add = () =>
    change([
      ...rows,
      {
        key: newKey(),
        name: '',
        base: rows.length === 0 ? 'TOTAL' : 'REMAINDER',
        percent: '',
        positionIds: [],
      },
    ]);

  function save() {
    if (!actions.setSectors || !check.ok) return;
    setError(null);
    startTransition(async () => {
      const result = await actions.setSectors?.(
        rows.map((r, index) => ({
          name: r.name.trim(),
          base: index === 0 ? 'TOTAL' : r.base,
          percent: r.percent.trim(),
          positionIds: r.positionIds,
        })),
      );
      if (result) setError(result);
      else setSaved(true);
    });
  }

  if (!actions.setSectors) return null;
  const editable = canEdit && !pending;
  const leftover = check.ok && check.leftover.num > 0n;

  return (
    <Card className="mt-6 gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayersIcon className="size-5 shrink-0 text-primary" />
          Reparto por sectores
        </CardTitle>
        <CardDescription className="space-y-2">
          <span className="block">
            Armá los sectores <span className="font-medium">en el orden en que se reparte</span> la
            propina. Cada sector se lleva un porcentaje del{' '}
            <span className="font-medium">total</span> o del{' '}
            <span className="font-medium">saldo que queda</span>.
          </span>
          <span className="block">
            Ejemplo: Cocina 30 % del total; Salón (camareros, supervisores y barra) 50 % del saldo;
            Bacha lo que queda.
          </span>
          <span className="block">
            Dentro de cada sector, la plata se reparte entre su gente con las porciones de
            &ldquo;Puestos y porciones&rdquo; y los valores de &ldquo;Personal&rdquo;. Acá no se
            vuelven a cargar.
          </span>
        </CardDescription>
        <CardAction>
          {active ? (
            <Badge variant="success">Activo</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              No activo
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {legacy ? (
          <div
            role="status"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangleIcon className="size-4 shrink-0" />
              Revisá los sectores y guardalos de nuevo
            </p>
            <p className="mt-1 text-muted-foreground">
              Antes cada puesto era un sector. Ahora un sector puede tener varios puestos. Armamos
              un punto de partida con lo que tenías: revisalo y guardalo para poder repartir.
            </p>
          </div>
        ) : null}

        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Primero agregá los puestos (arriba): cada sector reúne uno o varios puestos.
          </p>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/30 p-3">
              <label htmlFor="sectors-example" className="mb-1 block text-sm font-medium">
                Probá con una propina de
              </label>
              <div className="relative sm:max-w-xs">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="sectors-example"
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular pl-7"
                  value={example}
                  aria-invalid={!exampleOk || undefined}
                  aria-describedby="sectors-example-help"
                  onChange={(e) => setExample(e.target.value)}
                />
              </div>
              <p id="sectors-example-help" className="mt-1 text-xs text-muted-foreground">
                {exampleOk
                  ? 'Cada paso muestra la cuenta con este monto. No se guarda.'
                  : 'Escribí un importe válido, como 100.000.'}
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm">
                <p className="text-muted-foreground">Todavía no hay sectores.</p>
                {canEdit ? (
                  <Button
                    variant="outline"
                    className="mt-3 w-full sm:w-auto"
                    disabled={!editable}
                    onClick={() => change(exampleRows(positions))}
                  >
                    Empezar con Cocina, Salón y Bacha
                  </Button>
                ) : null}
              </div>
            ) : (
              <ol className="space-y-3" aria-label="Sectores, en orden">
                {rows.map((row, index) => (
                  <SectorCard
                    key={row.key}
                    row={row}
                    index={index}
                    count={rows.length}
                    positions={positions}
                    peopleByPosition={view.peopleByPosition}
                    owner={owner}
                    result={live.get(row.key)}
                    editable={editable}
                    onChange={(patch) => update(row.key, patch)}
                    onToggle={(positionId) => togglePosition(row.key, positionId)}
                    onMove={(delta) => move(index, delta)}
                    onRemove={() => change(rows.filter((r) => r.key !== row.key))}
                  />
                ))}
              </ol>
            )}

            {canEdit && rows.length > 0 && rows.length < MAX_SECTORS ? (
              <Button
                variant="outline"
                className="w-full border-dashed"
                disabled={!editable}
                onClick={add}
              >
                <PlusIcon />
                Agregar sector
              </Button>
            ) : null}

            {rows.length > 0 && outside.length > 0 ? (
              <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Sin sector:</span>{' '}
                {outside.map((p) => p.name).join(', ')}. Si alguien de{' '}
                {outside.length === 1 ? 'ese puesto' : 'esos puestos'} trabaja, el reparto no se va
                a poder cerrar hasta sumarlo a un sector.
              </p>
            ) : null}
          </>
        )}

        {summary && exampleCents !== null ? (
          <section aria-label="Resumen en pesos" aria-live="polite" className="space-y-2">
            <h3 className="text-sm font-medium">
              Resumen con <span className="tabular">{formatMoney(exampleCents)}</span>
              {check.ok ? null : (
                <span className="font-normal text-muted-foreground"> (parcial)</span>
              )}
            </h3>
            <SectorBreakdown summary={summary} showPeople={false} draft={!check.ok} />
          </section>
        ) : null}

        {!check.ok && rows.length > 0 ? (
          <div
            role="status"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangleIcon className="size-4 shrink-0" />
              Para guardar, falta completar:
            </p>
            <ul className="list-disc space-y-0.5 pl-6 text-muted-foreground">
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {canEdit ? (
          rows.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {leftover
                  ? 'Podés guardar, pero mientras sobre plata sin asignar el reparto no se puede cerrar.'
                  : active
                    ? 'Para volver a un pozo único, elegí "Sin grupos" en "Grupos y porcentajes".'
                    : 'Al guardar, el local pasa a repartir por sectores (crea una versión nueva).'}
              </p>
              <Button
                onClick={save}
                disabled={!check.ok || pending || (active && !dirty)}
                className="w-full shrink-0 sm:w-auto"
              >
                {pending ? <LoaderCircleIcon className="animate-spin" /> : <CheckCircle2Icon />}
                {pending
                  ? 'Guardando…'
                  : active
                    ? 'Guardar sectores'
                    : 'Guardar y repartir por sectores'}
              </Button>
            </div>
          ) : null
        ) : (
          <p className="text-xs text-muted-foreground">
            Solo el Dueño o el Encargado pueden cambiar los sectores.
          </p>
        )}
        {saved && !pending && !error ? (
          <p className="flex items-center gap-2 text-sm text-primary" role="status">
            <CheckCircle2Icon className="size-4 shrink-0" />
            Guardado. Los próximos repartos (y el que está abierto) usan estos sectores.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Un paso: nombre, porcentaje, base, puestos y la cuenta en pesos con el monto de prueba. */
function SectorCard({
  row,
  index,
  count,
  positions,
  peopleByPosition,
  owner,
  result,
  editable,
  onChange,
  onToggle,
  onMove,
  onRemove,
}: {
  row: Row;
  index: number;
  count: number;
  positions: Positions;
  peopleByPosition: Record<string, number>;
  owner: ReadonlyMap<string, Row>;
  result: ReturnType<typeof computeSectors>[number] | undefined;
  editable: boolean;
  onChange: (patch: Partial<Row>) => void;
  onToggle: (positionId: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const id = row.key;
  const first = index === 0;
  const base: SectorBase = first ? 'TOTAL' : row.base;
  const percentBad = row.percent.trim() !== '' && parseSectorPercent(row.percent) === null;
  const people = row.positionIds.reduce((sum, p) => sum + (peopleByPosition[p] ?? 0), 0);
  const label = row.name.trim() || `Sector ${index + 1}`;
  return (
    <li
      className={cn('rounded-lg border bg-card p-3', percentBad && 'border-destructive/50')}
      aria-label={`Paso ${index + 1}: ${label}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
        >
          {index + 1}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium">Paso {index + 1}</p>
        {editable ? (
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Subir ${label}`}
              disabled={first}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Bajar ${label}`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${label}`}
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2Icon />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)] gap-2">
        <div>
          <label htmlFor={`name-${id}`} className="mb-1 block text-xs text-muted-foreground">
            Sector
          </label>
          <Input
            id={`name-${id}`}
            autoComplete="off"
            placeholder="Ej.: Cocina"
            maxLength={60}
            value={row.name}
            disabled={!editable}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`percent-${id}`} className="mb-1 block text-xs text-muted-foreground">
            Porcentaje
          </label>
          <div className="relative">
            <Input
              id={`percent-${id}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              className="tabular pr-8 text-right"
              aria-invalid={percentBad || undefined}
              aria-describedby={`calc-${id}`}
              value={row.percent}
              disabled={!editable}
              onChange={(e) => onChange({ percent: e.target.value })}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1 text-xs text-muted-foreground">Se calcula sobre</legend>
        {first ? (
          <p className="text-sm">
            El total de la propina{' '}
            <span className="text-muted-foreground">(es el primer paso)</span>
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['TOTAL', 'El total original'],
                ['REMAINDER', 'El saldo que queda'],
              ] as const
            ).map(([value, text]) => (
              <label
                key={value}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 md:min-h-9',
                  base === value
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'bg-card text-muted-foreground',
                  !editable && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name={`base-${id}`}
                  value={value}
                  className="sr-only"
                  checked={base === value}
                  disabled={!editable}
                  onChange={() => onChange({ base: value })}
                />
                {text}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <p
        id={`calc-${id}`}
        className={cn(
          'mt-3 rounded-md px-2.5 py-2 text-sm',
          percentBad ? 'bg-destructive/5 text-destructive' : 'bg-muted/50',
        )}
      >
        {percentBad ? (
          'Escribí un número mayor que 0 y hasta 100 (hasta 2 decimales).'
        ) : result ? (
          <>
            <span className="tabular">
              {formatSectorPercent(result.percentE2)} % de{' '}
              <span className="whitespace-nowrap">{formatMoney(result.baseCents)}</span> ={' '}
              <span className="font-semibold whitespace-nowrap">
                {formatMoney(result.amountCents)}
              </span>
            </span>
            <span className="tabular block text-xs text-muted-foreground">
              {base === 'TOTAL' ? 'Base: el total original' : 'Base: el saldo que queda'} · después
              quedan <span className="whitespace-nowrap">{formatMoney(result.leftAfterCents)}</span>
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {row.percent.trim() === ''
              ? 'Escribí el porcentaje para ver la cuenta.'
              : 'Completá los pasos anteriores para ver la cuenta.'}
          </span>
        )}
      </p>

      <fieldset className="mt-3">
        <legend className="mb-1 text-xs text-muted-foreground">
          Puestos que cobran en este sector
        </legend>
        <div className="flex flex-wrap gap-2">
          {positions.map((p) => {
            const on = row.positionIds.includes(p.id);
            const elsewhere = !on ? owner.get(p.id) : undefined;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                disabled={!editable}
                onClick={() => onToggle(p.id)}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-foreground hover:bg-accent',
                )}
              >
                {on ? <CheckIcon className="size-3.5" /> : null}
                {p.name}
                {elsewhere ? (
                  <span className="text-xs text-muted-foreground">
                    (en {elsewhere.name.trim() || 'otro'})
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {row.positionIds.length === 0
            ? 'Sin puestos: el monto se entrega entero al sector, sin reparto por persona.'
            : `Se reparte entre ${people} ${people === 1 ? 'persona' : 'personas'} según su porción, sus horas y sus puntos.`}
        </p>
      </fieldset>
    </li>
  );
}
