'use client';

import { AlertTriangleIcon, CheckCircle2Icon, LayersIcon, LoaderCircleIcon } from 'lucide-react';
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
import { stagesToView } from '@/lib/distribution/sector-snapshot';
import {
  checkStages,
  computeStages,
  formatStagePercent,
  MAX_STAGES,
  parseStagePercent,
  stageBaseLabel,
} from '@/lib/distribution/sector-stages';
import { STAGED_GROUPS } from '@/lib/policy/changes';
import type { DistributionConfigActions, DistributionConfigView } from '@/lib/policy/view';
import { cn } from '@/lib/utils';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-card px-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60 md:text-sm';

const EXAMPLE_DEFAULT = '100.000';

interface Row {
  stage: string;
  percent: string;
}

/**
 * "Reparto por sectores": cada puesto es un sector con una etapa y un porcentaje. Se validan en
 * vivo (números, rango y que cada etapa cierre) y se muestra el resultado con un monto de ejemplo
 * antes de guardar. Solo se puede guardar una configuración completa: guarda todo junto en una
 * versión nueva y activa el reparto por sectores.
 */
export function SectorStagesEditor({
  view,
  canEdit,
  actions,
}: {
  view: DistributionConfigView;
  canEdit: boolean;
  actions: DistributionConfigActions;
}) {
  const version = view.current;
  const active = version.values.groups === STAGED_GROUPS;
  const initial = () =>
    Object.fromEntries(
      version.positions.map((p) => [
        p.id,
        { stage: p.stage ? String(p.stage) : '', percent: p.stagePercent ?? '' },
      ]),
    ) as Record<string, Row>;
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [example, setExample] = useState(EXAMPLE_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // Una versión nueva (de otro cambio o de este) vuelve a cargar lo guardado.
  const [seenVersion, setSeenVersion] = useState(version.number);
  if (seenVersion !== version.number) {
    setSeenVersion(version.number);
    setRows(initial());
  }

  const assignments = version.positions.map((p) => ({
    id: p.id,
    name: p.name,
    stage: rows[p.id]?.stage ? Number(rows[p.id]?.stage) : null,
    percent: (rows[p.id]?.percent ?? '').trim() === '' ? null : (rows[p.id]?.percent ?? null),
  }));
  const check = checkStages(assignments);
  const exampleCents = parseMoney(example);
  const exampleView =
    check.ok && exampleCents !== null && exampleCents > 0n
      ? stagesToView(computeStages(exampleCents, check.stages), new Map())
      : null;
  const dirty = version.positions.some((p) => {
    const row = rows[p.id];
    return (
      (row?.stage ?? '') !== (p.stage ? String(p.stage) : '') ||
      parseStagePercent(row?.percent ?? '') !== parseStagePercent(p.stagePercent ?? '')
    );
  });
  // Suma de cada etapa mientras se escribe (aunque falten datos), para guiar.
  const sums = Array.from({ length: MAX_STAGES }, (_, i) => i + 1)
    .map((stage) => {
      const members = assignments.filter((a) => a.stage === stage);
      const sumE2 = members.reduce((sum, a) => sum + (parseStagePercent(a.percent) ?? 0n), 0n);
      return { stage, members: members.length, sumE2 };
    })
    .filter((s) => s.members > 0);
  const lastStage = sums.length > 0 ? Math.max(...sums.map((s) => s.stage)) : 0;

  function update(id: string, patch: Partial<Row>) {
    setSaved(false);
    setRows((current) => ({
      ...current,
      [id]: { stage: '', percent: '', ...current[id], ...patch },
    }));
  }

  function save() {
    if (!actions.setStages || !check.ok) return;
    setError(null);
    startTransition(async () => {
      const result = await actions.setStages?.(
        version.positions.map((p) => ({
          positionId: p.id,
          stage: rows[p.id]?.stage ? Number(rows[p.id]?.stage) : null,
          percent: (rows[p.id]?.percent ?? '').trim(),
        })),
      );
      if (result) setError(result);
      else setSaved(true);
    });
  }

  if (!actions.setStages) return null;
  const editable = canEdit && !pending;

  return (
    <Card className="mt-6 gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayersIcon className="size-5 text-primary" />
          Reparto por sectores
        </CardTitle>
        <CardDescription>
          Cada puesto es un sector. La <span className="font-medium">etapa 1</span> se calcula sobre
          el <span className="font-medium">total</span> de la propina (p. ej. Cocina 30 %). Cada
          etapa siguiente se calcula sobre el <span className="font-medium">saldo</span> que dejó la
          anterior (p. ej. Salón, Barra y Supervisores; después Bacha). La última etapa reparte su
          porcentaje del saldo: con 100 % se reparte todo; con menos, lo que queda se muestra como
          sin asignar y no se puede cerrar el reparto hasta ajustarlo. Dentro de cada sector, el
          monto se reparte entre su gente según las horas y el método de participación.
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
        {version.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Primero agregá los puestos (arriba): cada puesto es un sector.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Sector (puesto)</th>
                  <th className="w-44 px-3 py-2 text-left font-medium">Etapa</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">Porcentaje</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {version.positions.map((p) => {
                  const row = rows[p.id] ?? { stage: '', percent: '' };
                  const percentBad =
                    row.percent.trim() !== '' && parseStagePercent(row.percent) === null;
                  const stage = row.stage ? Number(row.stage) : null;
                  return (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium">
                        {p.name}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {view.peopleByPosition[p.id] ?? 0} personas
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`stage-${p.id}`}>
                          Etapa de {p.name}
                        </label>
                        <select
                          id={`stage-${p.id}`}
                          className={SELECT_CLASS}
                          value={row.stage}
                          disabled={!editable}
                          onChange={(e) => update(p.id, { stage: e.target.value })}
                        >
                          <option value="">Elegí…</option>
                          {Array.from({ length: MAX_STAGES }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              Etapa {n} · {n === 1 ? 'del total' : 'del saldo'}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`percent-${p.id}`}>
                          Porcentaje de {p.name}
                        </label>
                        <div className="relative">
                          <Input
                            id={`percent-${p.id}`}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                            className={cn(
                              'tabular pr-7 text-right',
                              percentBad && 'border-destructive',
                            )}
                            aria-invalid={percentBad || undefined}
                            value={row.percent}
                            disabled={!editable}
                            onChange={(e) => update(p.id, { percent: e.target.value })}
                          />
                          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                        {stage ? (
                          <span className="mt-0.5 block text-right text-[11px] text-muted-foreground">
                            {stageBaseLabel(stage === 1 ? 'TOTAL' : 'REMAINDER')}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {sums.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-xs" aria-label="Suma de cada etapa">
            {sums.map((s) => {
              const closes =
                s.stage === lastStage ? s.sumE2 === 10_000n : s.sumE2 > 0n && s.sumE2 < 10_000n;
              const lastShort = s.stage === lastStage && s.sumE2 > 0n && s.sumE2 < 10_000n;
              return (
                <li
                  key={s.stage}
                  className={cn(
                    'rounded-md border px-2 py-1',
                    closes ? 'border-primary/40 bg-primary/5' : 'border-warning/50 bg-warning/10',
                  )}
                >
                  Etapa {s.stage}:{' '}
                  <span className="tabular font-medium">{formatStagePercent(s.sumE2)} %</span>{' '}
                  {s.stage === 1 ? 'del total' : 'del saldo'}
                  {s.stage !== lastStage
                    ? ' (menos de 100 %)'
                    : lastShort
                      ? ` (queda ${formatStagePercent(10_000n - s.sumE2)} % sin asignar)`
                      : ' (100 % reparte todo el saldo)'}
                </li>
              );
            })}
          </ul>
        ) : null}

        {!check.ok && version.positions.length > 0 ? (
          <div
            role="status"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangleIcon className="size-4" />
              Para guardar, falta completar:
            </p>
            <ul className="list-disc space-y-0.5 pl-6 text-muted-foreground">
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {check.ok ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="stages-example" className="text-muted-foreground">
                Probá con una propina de
              </label>
              <div className="relative w-36">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="stages-example"
                  inputMode="decimal"
                  className="tabular pl-7"
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                />
              </div>
            </div>
            {exampleView ? (
              <SectorBreakdown stages={exampleView} showPeople={false} />
            ) : (
              <p className="text-xs text-destructive">Escribí un importe válido, como 100.000.</p>
            )}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {canEdit ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {active
                ? 'Para volver a un pozo único, elegí "Sin grupos" en "Grupos y porcentajes".'
                : 'Al guardar, el local pasa a repartir por sectores (crea una versión nueva).'}
            </p>
            <Button
              onClick={save}
              disabled={!check.ok || pending || (active && !dirty)}
              className="shrink-0"
            >
              {pending ? <LoaderCircleIcon className="animate-spin" /> : <CheckCircle2Icon />}
              {active ? 'Guardar cambios' : 'Guardar y repartir por sectores'}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Solo el Dueño o el Encargado pueden cambiar los porcentajes.
          </p>
        )}
        {saved && !pending && !error ? (
          <p className="flex items-center gap-2 text-sm text-primary" role="status">
            <CheckCircle2Icon className="size-4" />
            Guardado. Los próximos repartos (y el que está abierto) usan esta configuración.
          </p>
        ) : null}
        {exampleCents !== null && exampleCents > 0n && !check.ok ? (
          <p className="text-xs text-muted-foreground">
            Cuando la configuración esté completa vas a ver cómo se reparten{' '}
            {formatMoney(exampleCents)}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
