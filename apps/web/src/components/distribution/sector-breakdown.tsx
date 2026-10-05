import { CornerDownRightIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react';
import { formatMoney } from '@/lib/decimal';
import type { SectorStageView, SectorsSummary } from '@/lib/distribution/sector-snapshot';
import {
  formatStagePercent,
  stageBaseLabel,
  unassignedCents,
} from '@/lib/distribution/sector-stages';
import { cn } from '@/lib/utils';

const money = (cents: string | bigint) => formatMoney(BigInt(cents));

/**
 * Reparto por sectores, paso a paso: sobre qué base se calcula cada porcentaje (el total o el
 * saldo que queda), cuánto recibe cada sector, cuánto queda después y, al final, lo que queda sin
 * asignar con cómo resolverlo. Lo usan la configuración (ejemplo en vivo), el reparto en curso, el
 * reparto cerrado y el historial (desde el snapshot, sin recalcular): todos ven lo mismo.
 *
 * Pensado primero para el celular: una columna, los montos nunca se parten en dos renglones y la
 * cuenta de cada paso ("30 % de $ 100.000") va debajo del nombre, en texto chico pero legible.
 */
export function SectorBreakdown({
  summary,
  showPeople = true,
  draft = false,
}: {
  summary: SectorsSummary;
  /** Mostrar cuántas personas cobran en cada sector (no en el ejemplo de la configuración). */
  showPeople?: boolean;
  /** Configuración a medio completar: lo que queda se muestra como "todavía sin repartir". */
  draft?: boolean;
}) {
  if (summary.kind === 'stages') return <LegacyStages stages={summary.stages} />;
  const assigned = summary.steps.reduce((sum, s) => sum + BigInt(s.amountCents), 0n);
  const unassigned = BigInt(summary.unassignedCents);
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-muted-foreground">Propina total</span>
        <span className="tabular font-semibold whitespace-nowrap">{money(summary.totalCents)}</span>
      </p>
      <ol className="space-y-3">
        {summary.steps.map((step, index) => {
          const left = BigInt(step.leftAfterCents);
          const isLast = index === summary.steps.length - 1;
          const onTotal = step.base === 'TOTAL';
          return (
            <li key={step.id} className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                  >
                    {index + 1}
                  </span>
                  <p className="min-w-0">
                    <span className="font-medium break-words">{step.name}</span>
                    <span className="tabular block text-xs text-muted-foreground">
                      {formatStagePercent(BigInt(step.percentE2))} %{' '}
                      {onTotal ? 'del total' : 'del saldo'} (
                      <span className="whitespace-nowrap">{money(step.baseCents)}</span>)
                    </span>
                  </p>
                </div>
                <span className="tabular shrink-0 text-base font-semibold whitespace-nowrap">
                  {money(step.amountCents)}
                </span>
              </div>
              <p className="flex items-start gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
                <UsersIcon className="mt-0.5 size-3.5 shrink-0" />
                {step.positions.length === 0 ? (
                  <span>Sin puestos: el monto se entrega entero al sector.</span>
                ) : (
                  <span className="min-w-0 break-words">
                    {step.positions.join(', ')}
                    {showPeople
                      ? ` · ${step.people} ${step.people === 1 ? 'persona' : 'personas'}`
                      : ''}{' '}
                    · se reparte según porción, horas y puntos
                  </span>
                )}
              </p>
              {!isLast || left > 0n ? (
                <div
                  className={cn(
                    'border-t border-dashed px-3 py-2 text-xs',
                    isLast ? 'bg-warning/10' : 'bg-muted/20',
                  )}
                >
                  <p className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <CornerDownRightIcon className="size-3.5 shrink-0" />
                      Quedan
                    </span>
                    <span className="tabular shrink-0 text-sm font-medium whitespace-nowrap">
                      {money(left)}
                    </span>
                  </p>
                  <p className="tabular mt-0.5 pl-5 text-muted-foreground">
                    <span className="whitespace-nowrap">{money(step.availableCents)}</span> −{' '}
                    <span className="whitespace-nowrap">{money(step.amountCents)}</span>
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="flex items-center justify-between gap-3 border-t px-1 pt-3 font-medium">
        <span>Repartido entre sectores</span>
        <span className="tabular whitespace-nowrap">{formatMoney(assigned)}</span>
      </p>
      {unassigned > 0n ? (
        <div
          role={draft ? undefined : 'alert'}
          className={cn(
            'rounded-lg border px-3 py-2.5',
            draft ? 'border-warning/50 bg-warning/10' : 'border-destructive/40 bg-destructive/5',
          )}
        >
          <p
            className={cn(
              'flex items-start justify-between gap-3 font-medium',
              !draft && 'text-destructive',
            )}
          >
            <span className="flex min-w-0 items-start gap-1.5">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {draft ? 'Todavía sin repartir' : 'Sin asignar'}
            </span>
            <span className="tabular shrink-0 whitespace-nowrap">{formatMoney(unassigned)}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {draft
              ? 'Completá los sectores que faltan para ver adónde va.'
              : 'Esta plata no es de ningún sector y no se reparte sola. Para resolverlo, subí el porcentaje del último sector (100 % del saldo se lleva todo lo que queda) o agregá un sector para ese saldo. Mientras tanto, el reparto no se puede cerrar.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Repartos cerrados antes del 2026-10-05: cada puesto era un sector dentro de una etapa. */
function LegacyStages({ stages }: { stages: readonly SectorStageView[] }) {
  const total = stages.reduce((sum, s) => sum + BigInt(s.amountCents), 0n);
  const unassigned = unassignedCents(stages);
  const last = stages[stages.length - 1];
  return (
    <ol className="space-y-3 text-sm">
      {stages.map((stage, index) => {
        const remainder = BigInt(stage.remainderCents);
        const isLast = index === stages.length - 1;
        return (
          <li key={stage.number} className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-start justify-between gap-3 border-b bg-muted/40 px-3 py-2">
              <p className="min-w-0">
                <span className="font-medium">Etapa {stage.number}</span>
                <span className="block text-xs text-muted-foreground">
                  {stageBaseLabel(stage.base)} · base{' '}
                  <span className="tabular whitespace-nowrap">{money(stage.baseCents)}</span>
                </span>
              </p>
              <p className="shrink-0 text-right">
                <span className="tabular font-medium whitespace-nowrap">
                  {money(stage.amountCents)}
                </span>
                <span className="tabular block text-xs text-muted-foreground">
                  {formatStagePercent(BigInt(stage.percentE2))} % de la base
                </span>
              </p>
            </div>
            <ul className="divide-y">
              {stage.sectors.map((sector) => (
                <li key={sector.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <p className="min-w-0">
                    <span className="font-medium break-words">{sector.name}</span>
                    <span className="tabular block text-xs text-muted-foreground">
                      {formatStagePercent(BigInt(sector.percentE2))} % de{' '}
                      <span className="whitespace-nowrap">{money(stage.baseCents)}</span>
                      {` · ${sector.people} ${sector.people === 1 ? 'persona' : 'personas'}`}
                    </span>
                  </p>
                  <span className="tabular shrink-0 font-semibold whitespace-nowrap">
                    {money(sector.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
            {remainder > 0n && !isLast ? (
              <p className="flex items-center justify-between gap-3 border-t border-dashed bg-muted/20 px-3 py-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <CornerDownRightIcon className="size-3.5 shrink-0" />
                  Pasa a la etapa {stage.number + 1}
                </span>
                <span className="tabular shrink-0 text-sm font-medium whitespace-nowrap">
                  {money(remainder)}
                </span>
              </p>
            ) : null}
          </li>
        );
      })}
      <li className="flex items-center justify-between gap-3 border-t px-1 pt-3 font-medium">
        <span>Repartido entre sectores</span>
        <span className="tabular whitespace-nowrap">{formatMoney(total)}</span>
      </li>
      {unassigned > 0n && last ? (
        <li className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 font-medium text-destructive">
          <span className="flex min-w-0 items-start gap-1.5">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            Sin asignar
          </span>
          <span className="tabular shrink-0 whitespace-nowrap">{formatMoney(unassigned)}</span>
        </li>
      ) : null}
    </ol>
  );
}
