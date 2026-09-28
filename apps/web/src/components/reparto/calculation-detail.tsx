'use client';

import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { useState } from 'react';
import { formatMoney, formatScaled } from '@/lib/decimal';
import { formatHoursE2 } from '@/lib/distribution/period-view';

export interface DetailRow {
  employeeId: string;
  name: string;
  positionName: string;
  hoursE2: bigint;
  factor: string;
  pointsE6: bigint;
  amountCents: bigint;
  advanceCents: bigint;
  finalCents: bigint;
}

const points = (e6: bigint) => formatScaled(e6, 6, 3);

/**
 * "¿Cómo se calculó?": la cuenta de cada persona, plegada por defecto. Primero la explicación
 * simple (cuánto vale una hora de cada puesto) y después el detalle con porción y puntos.
 */
export function CalculationDetail({
  rows,
  totalCents,
  totalPointsE6,
  roundingLabel,
}: {
  rows: readonly DetailRow[];
  totalCents: bigint;
  totalPointsE6: bigint;
  roundingLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0 || totalPointsE6 === 0n) return null;
  const pointValue = (totalCents * 1_000_000n * 2n + totalPointsE6) / (totalPointsE6 * 2n);
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        ¿Cómo se calculó?
        {open ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
      </button>
      {open ? (
        <div className="space-y-4 border-t px-4 py-4 text-sm">
          <p className="text-muted-foreground">
            Cada hora trabajada suma <strong className="text-foreground">puntos</strong> según la{' '}
            <strong className="text-foreground">porción</strong> de su puesto (horas × porción). La
            propina se reparte en proporción a los puntos de cada persona y se redondea a{' '}
            {roundingLabel} de forma que la suma dé exacto el total.
          </p>
          <dl className="grid grid-cols-1 gap-2 rounded-lg bg-muted/50 p-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Propina a repartir</dt>
              <dd className="tabular font-medium">{formatMoney(totalCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total de puntos</dt>
              <dd className="tabular font-medium">{points(totalPointsE6)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valor de 1 punto</dt>
              <dd className="tabular font-medium">{formatMoney(pointValue)}</dd>
            </div>
          </dl>
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.employeeId} className="py-2">
                <p className="font-medium">
                  {row.name}{' '}
                  <span className="font-normal text-muted-foreground">· {row.positionName}</span>
                </p>
                <p className="tabular text-muted-foreground">
                  {formatHoursE2(row.hoursE2)} h × {row.factor} de porción = {points(row.pointsE6)}{' '}
                  puntos → {points(row.pointsE6)} × {formatMoney(pointValue)} ≈{' '}
                  <span className="text-foreground">{formatMoney(row.amountCents)}</span>
                  {row.advanceCents > 0n ? (
                    <>
                      {' '}
                      − adelanto {formatMoney(row.advanceCents)} ={' '}
                      <span className="font-medium text-foreground">
                        {formatMoney(row.finalCents)}
                      </span>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
