import { toneOf } from '@/components/gutip/badges';
import type {
  DistributionRowView,
  DistributionTotalsView,
} from '@/components/distribution/distribution-table';
import type { ProvisionalResult } from '@/lib/distribution/provisional-formula';
import { positionById, positionsOf, type Venue, type WeekResult } from './model';

/** Filas de una semana cerrada (datos congelados al cierre). */
export function closedRowsView(venue: Venue, result: WeekResult): DistributionRowView[] {
  return result.rows.map((row) => ({
    id: row.staffId,
    name: row.name,
    positionName: row.positionName,
    tone: toneOf(positionsOf(venue), row.positionId),
    hoursE2: BigInt(row.hoursE2),
    factorE4: BigInt(row.factorE4),
    pointsE6: BigInt(row.pointsE6),
    percentE2: BigInt(row.percentE2),
    amountCents: BigInt(row.amountCents),
    advanceCents: BigInt(row.advanceCents),
    pendingAdvanceCents: BigInt(row.pendingAdvanceCents),
    finalCents: BigInt(row.finalCents),
  }));
}

export function closedTotalsView(result: WeekResult): DistributionTotalsView {
  return {
    totalCents: BigInt(result.totalCents),
    totalPointsE6: BigInt(result.totalPointsE6),
    totalAdvanceCents: BigInt(result.totalAdvanceCents),
    totalFinalCents: BigInt(result.totalFinalCents),
  };
}

/** Filas de la vista previa de una semana abierta (personal actual). */
export function previewRowsView(venue: Venue, result: ProvisionalResult): DistributionRowView[] {
  const staffById = new Map(venue.staff.map((member) => [member.id, member]));
  // Como en el cierre: solo quien tiene puntos o adelantos.
  const involved = result.items.filter(
    (item) => item.pointsE6 > 0n || item.advanceAppliedCents > 0n || item.pendingAdvanceCents > 0n,
  );
  return involved.map((item) => {
    const member = staffById.get(item.id);
    const positionId = member?.positionId ?? '';
    return {
      id: item.id,
      name: member?.name ?? item.id,
      positionName: positionById(venue, positionId)?.name ?? '',
      tone: toneOf(positionsOf(venue), positionId),
      hoursE2: item.hoursE2,
      factorE4: item.factorE4,
      pointsE6: item.pointsE6,
      percentE2: item.percentE2,
      amountCents: item.amountCents,
      advanceCents: item.advanceAppliedCents,
      pendingAdvanceCents: item.pendingAdvanceCents,
      finalCents: item.finalCents,
    };
  });
}
