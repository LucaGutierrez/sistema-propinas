import { PositionBadge } from '@/components/gutip/badges';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, formatScaled } from '@/lib/decimal';
import {
  FACTOR_SCALE,
  HOURS_SCALE,
  PERCENT_SCALE,
  POINTS_SCALE,
} from '@/lib/distribution/provisional-formula';
import { cn } from '@/lib/utils';

export interface DistributionRowView {
  id: string;
  name: string;
  positionName: string;
  tone: number;
  hoursE2: bigint;
  factorE4: bigint;
  pointsE6: bigint;
  percentE2: bigint;
  amountCents: bigint;
  advanceCents: bigint;
  pendingAdvanceCents: bigint;
  finalCents: bigint;
}

export interface DistributionTotalsView {
  totalCents: bigint;
  totalPointsE6: bigint;
  totalAdvanceCents: bigint;
  totalFinalCents: bigint;
}

export const fmtHours = (value: bigint) =>
  `${formatScaled(value, HOURS_SCALE, 2).replace(/,00$/, '')} h`;
export const fmtFactor = (value: bigint) => formatScaled(value, FACTOR_SCALE, 3);
export const fmtPoints = (value: bigint) => formatScaled(value, POINTS_SCALE, 3);
export const fmtPercent = (value: bigint) => `${formatScaled(value, PERCENT_SCALE, 2)} %`;

function AdvanceCell({ row }: { row: DistributionRowView }) {
  return (
    <>
      {row.advanceCents > 0n ? `− ${formatMoney(row.advanceCents)}` : '—'}
      {row.pendingAdvanceCents > 0n ? (
        <span className="block text-xs text-warning-foreground">
          saldo {formatMoney(row.pendingAdvanceCents)}
        </span>
      ) : null}
    </>
  );
}

/** Tabla del reparto: tarjetas en celular, tabla completa en escritorio. */
export function DistributionTable({
  rows,
  totals,
}: {
  rows: readonly DistributionRowView[];
  totals: DistributionTotalsView;
}) {
  return (
    <>
      <ul className="divide-y border-t md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{row.name}</span>
                <PositionBadge name={row.positionName} tone={row.tone} />
              </div>
              <span className="tabular font-semibold">{formatMoney(row.finalCents)}</span>
            </div>
            <p className="tabular mt-1 text-xs text-muted-foreground">
              {fmtHours(row.hoursE2)} × {fmtFactor(row.factorE4)} = {fmtPoints(row.pointsE6)} pts ·{' '}
              {fmtPercent(row.percentE2)} · importe {formatMoney(row.amountCents)}
              {row.advanceCents > 0n ? ` − adelanto ${formatMoney(row.advanceCents)}` : ''}
              {row.pendingAdvanceCents > 0n
                ? ` · saldo pendiente ${formatMoney(row.pendingAdvanceCents)}`
                : ''}
            </p>
          </li>
        ))}
        <li className="tabular flex justify-between bg-muted/50 px-5 py-3 text-sm font-medium">
          <span>Total</span>
          <span>{formatMoney(totals.totalFinalCents)}</span>
        </li>
      </ul>

      <div className="hidden border-t md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Empleado</TableHead>
              <TableHead>Puesto</TableHead>
              <TableHead className="text-right">Horas semana</TableHead>
              <TableHead className="text-right">Porción</TableHead>
              <TableHead className="text-right">Puntos</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="text-right">Adelanto</TableHead>
              <TableHead className="pr-5 text-right">Total final</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(row.pointsE6 === 0n && 'text-muted-foreground')}>
                <TableCell className="pl-5 font-medium">{row.name}</TableCell>
                <TableCell>
                  <PositionBadge name={row.positionName} tone={row.tone} />
                </TableCell>
                <TableCell className="tabular text-right">{fmtHours(row.hoursE2)}</TableCell>
                <TableCell className="tabular text-right">{fmtFactor(row.factorE4)}</TableCell>
                <TableCell className="tabular text-right">{fmtPoints(row.pointsE6)}</TableCell>
                <TableCell className="tabular text-right">{fmtPercent(row.percentE2)}</TableCell>
                <TableCell className="tabular text-right">{formatMoney(row.amountCents)}</TableCell>
                <TableCell className="tabular text-right">
                  <AdvanceCell row={row} />
                </TableCell>
                <TableCell className="tabular pr-5 text-right font-semibold">
                  {formatMoney(row.finalCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5" colSpan={4}>
                Totales
              </TableCell>
              <TableCell className="tabular text-right">
                {fmtPoints(totals.totalPointsE6)}
              </TableCell>
              <TableCell className="tabular text-right">100,00 %</TableCell>
              <TableCell className="tabular text-right">{formatMoney(totals.totalCents)}</TableCell>
              <TableCell className="tabular text-right">
                {totals.totalAdvanceCents > 0n ? `− ${formatMoney(totals.totalAdvanceCents)}` : '—'}
              </TableCell>
              <TableCell className="tabular pr-5 text-right">
                {formatMoney(totals.totalFinalCents)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}
