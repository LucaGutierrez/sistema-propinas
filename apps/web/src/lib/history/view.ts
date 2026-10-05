/**
 * Historial (solo lectura): lo que la pantalla recibe del servidor. Todo sale de lo que quedó
 * guardado al cerrar cada reparto (ítems, sobres, eventos, adelantos); nada se recalcula ni se
 * reconstruye con la configuración actual. Importes como texto de centavos.
 */
import type { ParticipationMethod } from '@/lib/distribution/participation';
import type { SectorsSummary } from '@/lib/distribution/sector-snapshot';
import type { PortionDisplay } from '@/lib/policy/portion-format';
import type { EnvelopeEventType, EnvelopeStatus } from '@/lib/envelopes/view';

export type HistoryStatus = 'CLOSED' | 'VOIDED';

export interface HistoryFilters {
  /** null = todos (cerrados y eliminados). Por defecto, solo los cerrados. */
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
  /** Porción usada (snapshot); null si el método no la usó o no hay detalle. */
  factor: string | null;
  /** Puntos individuales usados (snapshot); null si el método no los usó o no hay detalle. */
  individualPoints: string | null;
  /** Ponderado exacto (E8, snapshot); vacío si no hay detalle. */
  weightE8: string;
  /** Ponderado en la escala anterior (E6, redondeado); se conserva por compatibilidad. */
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
  /** Método de participación con el que se calculó. */
  method: ParticipationMethod;
  /** Cómo se muestran las porciones (preferencia actual: solo presentación). */
  portionDisplay: PortionDisplay;
  calcVersion: string | null;
  /**
   * Reparto por sectores guardado al cerrar: configuración aplicada (etapa, base y % de cada
   * sector) y resultado por sector. null con pozo único o para SELF (revelaría los totales).
   */
  sectorStages: SectorsSummary | null;
  /** Totales del reparto (null para SELF: no se revelan). */
  totals: {
    tipsCents: string;
    advancesCents: string;
    finalCents: string;
    pointsE6: string;
    /** Σ ponderado exacto (E8). */
    weightE8: string;
    participants: number;
  } | null;
  /** El detalle por persona está disponible (en un reparto anulado puede faltar). */
  detailAvailable: boolean;
  /** Reparto anulado que este rehace (re-liquidación), y el que rehízo a este. */
  supersedes: { settlementId: string } | null;
  supersededBy: { settlementId: string; status: 'OPEN' | 'CLOSED' | 'VOIDED' } | null;
  /** Sobres entregados: mientras haya alguno, el reparto no se puede anular. */
  deliveredEnvelopes: number;
  /** Según el rol (Dueño/Encargado) y el estado; el servidor lo vuelve a verificar al actuar. */
  canVoid: boolean;
  canRedo: boolean;
  people: HistoryPersonRow[];
  advances: HistoryAdvance[];
  events: HistoryEvent[];
}
