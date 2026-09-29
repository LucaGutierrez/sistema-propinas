'use client';

import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { useState } from 'react';
import { formatMoney } from '@/lib/decimal';
import { WEIGHT_SCALE, type ParticipationMethod } from '@/lib/distribution/participation';
import { formatHoursE2, formatWeight, weightInputsText } from '@/lib/distribution/period-view';
import type { PortionDisplay } from '@/lib/policy/portion-format';

export interface DetailRow {
  employeeId: string;
  name: string;
  positionName: string;
  hoursE2: bigint;
  /** Porción del puesto (null si el método no la usa). */
  factor: string | null;
  /** Puntos individuales (null si el método no los usa). */
  individualPoints: string | null;
  /** Ponderado (E8). */
  weightE8: bigint;
  amountCents: bigint;
  advanceCents: bigint;
  finalCents: bigint;
}

const EXPLANATION: Record<ParticipationMethod, string> = {
  BY_POSITION: 'horas × porción del puesto',
  BY_POINTS: 'horas × puntos de la persona',
  BY_POSITION_TIMES_POINTS: 'horas × porción del puesto × puntos de la persona',
};

/**
 * "¿Cómo se calculó?": la cuenta de cada persona, plegada por defecto. Primero la regla del método
 * de participación y después, por persona, horas × porción y/o puntos = ponderado → importe.
 */
export function CalculationDetail({
  rows,
  totalCents,
  totalWeightE8,
  roundingLabel,
  method,
  portionDisplay,
}: {
  rows: readonly DetailRow[];
  totalCents: bigint;
  totalWeightE8: bigint;
  roundingLabel: string;
  method: ParticipationMethod;
  portionDisplay: PortionDisplay;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0 || totalWeightE8 === 0n) return null;
  const one = 10n ** BigInt(WEIGHT_SCALE);
  const unitValue = (totalCents * one * 2n + totalWeightE8) / (totalWeightE8 * 2n);
  const inputs = (row: DetailRow) =>
    weightInputsText({ ...row, hours: formatHoursE2(row.hoursE2) }, portionDisplay);
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
            El <strong className="text-foreground">ponderado</strong> de cada persona es{' '}
            {EXPLANATION[method]}. La propina se reparte en proporción al ponderado de cada persona
            (su <strong className="text-foreground">participación</strong>) y se redondea a{' '}
            {roundingLabel} de forma que la suma dé exacto el total.
          </p>
          <dl className="grid grid-cols-1 gap-2 rounded-lg bg-muted/50 p-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Propina a repartir</dt>
              <dd className="tabular font-medium">{formatMoney(totalCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ponderado total</dt>
              <dd className="tabular font-medium">{formatWeight(totalWeightE8)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valor de 1 de ponderado</dt>
              <dd className="tabular font-medium">{formatMoney(unitValue)}</dd>
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
                  {inputs(row)} = {formatWeight(row.weightE8)} de ponderado →{' '}
                  {formatWeight(row.weightE8)} × {formatMoney(unitValue)} ≈{' '}
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
