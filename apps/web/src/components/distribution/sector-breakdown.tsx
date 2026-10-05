import { ArrowDownIcon, TriangleAlertIcon } from 'lucide-react';
import { formatMoney } from '@/lib/decimal';
import type { SectorStageView } from '@/lib/distribution/sector-snapshot';
import {
  formatStagePercent,
  stageBaseLabel,
  unassignedCents,
} from '@/lib/distribution/sector-stages';

/**
 * Reparto por sectores, etapa por etapa: sobre qué base se calcula cada porcentaje, cuánto recibe
 * cada sector, qué saldo pasa a la etapa siguiente y cuánto queda sin asignar (si la última etapa
 * reparte menos de 100 %). Lo usan la configuración (ejemplo), el reparto
 * en curso y el detalle de un reparto cerrado (desde su snapshot).
 */
export function SectorBreakdown({
  stages,
  showPeople = true,
}: {
  stages: readonly SectorStageView[];
  /** Mostrar cuántas personas cobran en cada sector (no en el ejemplo de la configuración). */
  showPeople?: boolean;
}) {
  const total = stages.reduce((sum, s) => sum + BigInt(s.amountCents), 0n);
  const unassigned = unassignedCents(stages);
  return (
    <ol className="space-y-2 text-sm">
      {stages.map((stage, index) => {
        const remainder = BigInt(stage.remainderCents);
        const isLast = index === stages.length - 1;
        return (
          <li key={stage.number}>
            <div className="rounded-lg border">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b bg-muted/40 px-3 py-2">
                <span className="font-medium">
                  Etapa {stage.number}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {stageBaseLabel(stage.base)}
                  </span>
                </span>
                <span className="tabular text-xs text-muted-foreground">
                  Base {formatMoney(BigInt(stage.baseCents))} ·{' '}
                  {formatStagePercent(BigInt(stage.percentE2))} % ={' '}
                  {formatMoney(BigInt(stage.amountCents))}
                </span>
              </p>
              <ul className="divide-y">
                {stage.sectors.map((sector) => (
                  <li
                    key={sector.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{sector.name}</span>{' '}
                      <span className="tabular text-xs text-muted-foreground">
                        {formatStagePercent(BigInt(sector.percentE2))} % de{' '}
                        {formatMoney(BigInt(stage.baseCents))}
                        {showPeople
                          ? ` · ${sector.people} ${sector.people === 1 ? 'persona' : 'personas'}`
                          : ''}
                      </span>
                    </span>
                    <span className="tabular font-semibold">
                      {formatMoney(BigInt(sector.amountCents))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {remainder > 0n && !isLast ? (
              <p className="flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground">
                <ArrowDownIcon className="size-3.5" />
                {formatMoney(BigInt(stage.baseCents))} − {formatMoney(BigInt(stage.amountCents))} =
                saldo de{' '}
                <span className="tabular font-medium text-foreground">
                  {formatMoney(remainder)}
                </span>{' '}
                para la etapa {stage.number + 1}
              </p>
            ) : null}
          </li>
        );
      })}
      <li className="flex justify-between gap-3 border-t px-3 pt-2 font-medium">
        <span>Total repartido entre sectores</span>
        <span className="tabular">{formatMoney(total)}</span>
      </li>
      {unassigned > 0n ? (
        <li className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 font-medium text-destructive">
          <span className="flex items-start gap-1.5">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Sin asignar{' '}
              <span className="font-normal">
                ({formatMoney(BigInt(stages[stages.length - 1]?.baseCents ?? '0'))} −{' '}
                {formatMoney(BigInt(stages[stages.length - 1]?.amountCents ?? '0'))}): no pasa a
                ningún sector
              </span>
            </span>
          </span>
          <span className="tabular">{formatMoney(unassigned)}</span>
        </li>
      ) : null}
    </ol>
  );
}
