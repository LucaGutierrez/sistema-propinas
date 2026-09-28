/**
 * Sobres (weekly_payments) tal como los muestra la pantalla. Los importes viajan como texto de
 * centavos ("6658617"): salen del reparto cerrado y la pantalla nunca los recalcula.
 */

/** Mínimo de caracteres del motivo (lo exige la base en weekly_payment_events). */
export const MIN_REASON_LENGTH = 10;

export type EnvelopeStatus = 'PENDING' | 'PREPARED' | 'DELIVERED' | 'VOIDED';

export type EnvelopeEventType =
  'CREATED' | 'PREPARED' | 'PREPARATION_UNDONE' | 'DELIVERED' | 'DELIVERY_REVERTED' | 'VOIDED';

export const STATUS_LABEL: Record<EnvelopeStatus, string> = {
  PENDING: 'Pendiente',
  PREPARED: 'Preparado',
  DELIVERED: 'Entregado',
  VOIDED: 'Anulado',
};

export const EVENT_LABEL: Record<EnvelopeEventType, string> = {
  CREATED: 'Sobre generado al cerrar el reparto',
  PREPARED: 'Preparado',
  PREPARATION_UNDONE: 'Preparación deshecha',
  DELIVERED: 'Entregado',
  DELIVERY_REVERTED: 'Entrega revertida',
  VOIDED: 'Anulado',
};

export interface EnvelopeEventView {
  type: EnvelopeEventType;
  at: string;
  by: string;
  amountCents: string;
  reason: string | null;
}

export interface EnvelopeView {
  paymentId: string;
  employeeId: string;
  name: string;
  positionName: string | null;
  /** Le corresponde (antes de adelantos). */
  grossCents: string;
  advancesCents: string;
  /** A entregar. */
  netCents: string;
  status: EnvelopeStatus;
  preparedAt: string | null;
  preparedBy: string | null;
  deliveredAt: string | null;
  deliveredBy: string | null;
  deliveryNote: string | null;
  events: EnvelopeEventView[];
}

export interface EnvelopesPeriodView {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  status: 'CLOSED' | 'VOIDED';
  envelopes: EnvelopeView[];
  /** Solo los propios (rol SELF). */
  ownOnly: boolean;
  canHandle: boolean;
  canRevert: boolean;
}

export interface EnvelopeSummary {
  total: number;
  pending: number;
  prepared: number;
  delivered: number;
  /** Sobres sin importe a entregar (los adelantos se llevaron todo). */
  withoutAmount: number;
  /** Lo que falta entregar (pendientes + preparados). */
  toDeliverCents: bigint;
  deliveredCents: bigint;
}

export function summarize(
  envelopes: readonly { status: EnvelopeStatus; netCents: string }[],
): EnvelopeSummary {
  const summary: EnvelopeSummary = {
    total: 0,
    pending: 0,
    prepared: 0,
    delivered: 0,
    withoutAmount: 0,
    toDeliverCents: 0n,
    deliveredCents: 0n,
  };
  for (const envelope of envelopes) {
    if (envelope.status === 'VOIDED') continue;
    summary.total += 1;
    const cents = BigInt(envelope.netCents);
    if (cents === 0n) {
      summary.withoutAmount += 1;
      continue;
    }
    if (envelope.status === 'DELIVERED') {
      summary.delivered += 1;
      summary.deliveredCents += cents;
    } else {
      if (envelope.status === 'PREPARED') summary.prepared += 1;
      else summary.pending += 1;
      summary.toDeliverCents += cents;
    }
  }
  return summary;
}

/** Un período con sobres, para la lista de /sobres. */
export interface EnvelopePeriodItem {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  total: number;
  pending: number;
  prepared: number;
  delivered: number;
  toDeliverCents: string;
  deliveredCents: string;
}
