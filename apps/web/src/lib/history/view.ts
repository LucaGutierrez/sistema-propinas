/**
 * Historial (solo lectura): lo que la pantalla recibe del servidor. Todo sale de lo que quedó
 * guardado al cerrar cada reparto (ítems, sobres, eventos, adelantos); nada se recalcula ni se
 * reconstruye con la configuración actual. Importes como texto de centavos.
 */
import type { EnvelopeEventType, EnvelopeStatus } from '@/lib/envelopes/view';

export type HistoryStatus = 'CLOSED' | 'VOIDED';

export interface HistoryFilters {
  status: HistoryStatus | null;
  /** Semanas que empiezan desde / hasta esta fecha (ISO). */
  from: string | null;
  to: string | null;
  /** Nombre (o parte) de una persona que participó. */
  employee: string | null;
  page: number;
}

export interface HistoryListItem {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  status: HistoryStatus;
  closedAt: string | null;
  closedBy: string | null;
  voidedAt: string | null;
  /** Total repartido (o, para SELF, lo que le correspondió a la persona). */
  totalCents: string;
  /** Personas con propina (null para SELF: no se revela). */
  participants: number | null;
  envelopes: number;
  delivered: number;
  toDeliverCents: string;
}

export interface HistoryList {
  items: HistoryListItem[];
  ownOnly: boolean;
  hasMore: boolean;
}

export interface HistoryPersonRow {
  employeeId: string;
  name: string;
  positionName: string;
  hours: string;
  factor: string;
  pointsE6: string;
  percentE2: string;
  grossCents: string;
  advancesCents: string;
  finalCents: string;
  envelope: {
    paymentId: string;
    status: EnvelopeStatus;
    /** Hubo al menos una entrega revertida. */
    reverted: boolean;
  } | null;
}

export interface HistoryAdvance {
  advanceId: string;
  employeeName: string;
  date: string;
  note: string | null;
  /** Importe del adelanto registrado. */
  amountCents: string;
  /** Lo que se descontó en ESTE reparto. */
  appliedHereCents: string;
  /** Saldo pendiente hoy (lo que falta descontar en repartos futuros). */
  pendingNowCents: string;
  status: 'PENDING' | 'APPLIED' | 'VOIDED';
  /** El descuento en este reparto se revirtió (el reparto se anuló). */
  reverted: boolean;
}

export type HistoryEventKind = 'CLOSED' | 'VOIDED' | EnvelopeEventType;

export interface HistoryEvent {
  kind: HistoryEventKind;
  at: string;
  by: string;
  /** Persona del sobre (eventos de sobres). */
  employeeName: string | null;
  amountCents: string | null;
  reason: string | null;
}

export interface HistoryDetail {
  settlementId: string;
  weekStart: string;
  weekEnd: string;
  status: HistoryStatus;
  ownOnly: boolean;
  closedAt: string | null;
  closedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  /** Número de versión y redondeo de la política USADA (del snapshot del cierre). */
  policyNumber: number | null;
  roundingUnit: 'CENT' | 'PESO' | null;
  calcVersion: string | null;
  /** Totales del reparto (null para SELF: no se revelan). */
  totals: {
    tipsCents: string;
    advancesCents: string;
    finalCents: string;
    pointsE6: string;
    participants: number;
  } | null;
  /** El detalle por persona está disponible (en un reparto anulado puede faltar). */
  detailAvailable: boolean;
  people: HistoryPersonRow[];
  advances: HistoryAdvance[];
  events: HistoryEvent[];
}
