import { ArrowDownIcon } from 'lucide-react';
import { formatMoney } from '@/lib/decimal';
import type { SectorStageView } from '@/lib/distribution/sector-snapshot';
import { formatStagePercent, stageBaseLabel } from '@/lib/distribution/sector-stages';

/**
 * Reparto por sectores, etapa por etapa: sobre qué base se calcula cada porcentaje, cuánto recibe
 * cada sector y qué saldo pasa a la etapa siguiente. Lo usan la configuración (ejemplo), el reparto
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
  return (
    <ol className="space-y-2 text-sm">
      {stages.map((stage) => {
        const remainder = BigInt(stage.remainderCents);
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
                  Base {formatMoney(BigInt(stage.baseCents))}
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
            {remainder > 0n ? (
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
    </ol>
  );
}
