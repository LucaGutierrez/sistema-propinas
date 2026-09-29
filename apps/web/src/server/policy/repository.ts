/**
 * Lecturas de la política de distribución. TODAS filtran por `restaurantId`: una versión, un
 * puesto o un período de otro restaurante no existen para esta capa.
 */
import type { Prisma, PolicyOrigin } from '@prisma/client';
import type { PolicyOrigin as ViewOrigin } from '@/lib/demo-store/policy';
import type { DistributionConfig } from '@/lib/demo-store/config';
import {
  columnsToValues,
  portionFromDb,
  PORTION_DB_SCALE,
  type PolicyColumns,
} from '@/lib/policy/db-mapping';
import type { DistributionConfigView, PolicyVersionView } from '@/lib/policy/view';

/** Cliente Prisma o transacción en curso (las lecturas sirven para los dos). */
export type DbClient = Prisma.TransactionClient;

export interface PolicyPositionRecord {
  /** Identidad estable del puesto (`positions.id`). */
  positionId: string;
  name: string;
  /** Porción exacta de la base (NUMERIC(20,10)) como texto: "0.0220000000". */
  portion: string;
  /** Porción como se muestra: "0,022". */
  factor: string;
  sortOrder: number;
}

export interface PolicyVersionRecord {
  id: string;
  restaurantId: string;
  number: number;
  origin: PolicyOrigin;
  templateCode: string | null;
  templateVersion: number | null;
  previousVersionId: string | null;
  copiedFromVersionId: string | null;
  summary: string;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  columns: PolicyColumns;
  values: DistributionConfig;
  positions: PolicyPositionRecord[];
}

const versionSelect = {
  id: true,
  restaurantId: true,
  number: true,
  origin: true,
  templateCode: true,
  templateVersion: true,
  previousVersionId: true,
  copiedFromVersionId: true,
  summary: true,
  periodKind: true,
  periodStartWeekday: true,
  splitTiming: true,
  hoursBasis: true,
  hoursEntry: true,
  potSources: true,
  poolStructure: true,
  portionMode: true,
  roundingUnit: true,
  advanceDeduction: true,
  envelopeHandlers: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  positions: {
    select: {
      positionId: true,
      portion: true,
      sortOrder: true,
      position: { select: { name: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { positionId: 'asc' }],
  },
} satisfies Prisma.DistributionPolicyVersionSelect;

type VersionRow = Prisma.DistributionPolicyVersionGetPayload<{ select: typeof versionSelect }>;

function toRecord(row: VersionRow): PolicyVersionRecord {
  const columns: PolicyColumns = {
    periodKind: row.periodKind,
    periodStartWeekday: row.periodStartWeekday,
    splitTiming: row.splitTiming,
    hoursBasis: row.hoursBasis,
    hoursEntry: row.hoursEntry,
    potSources: row.potSources,
    poolStructure: row.poolStructure,
    portionMode: row.portionMode,
    roundingUnit: row.roundingUnit,
    advanceDeduction: row.advanceDeduction,
    envelopeHandlers: row.envelopeHandlers,
  };
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    number: row.number,
    origin: row.origin,
    templateCode: row.templateCode,
    templateVersion: row.templateVersion,
    previousVersionId: row.previousVersionId,
    copiedFromVersionId: row.copiedFromVersionId,
    summary: row.summary,
    createdById: row.createdById,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt,
    columns,
    values: columnsToValues(columns),
    positions: row.positions.map((p) => {
      // Decimal de Prisma → texto exacto (toFixed de decimal.js, sin pasar por floats).
      const portion = p.portion.toFixed(PORTION_DB_SCALE);
      return {
        positionId: p.positionId,
        name: p.position.name,
        portion,
        factor: portionFromDb(portion),
        sortOrder: p.sortOrder,
      };
    }),
  };
}

export async function getRestaurant(db: DbClient, restaurantId: string) {
  return db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, currentPolicyVersionId: true, portionDisplay: true },
  });
}

/** Una versión del restaurante (null si no existe o es de otro restaurante). */
export async function getPolicyVersion(
  db: DbClient,
  restaurantId: string,
  versionId: string,
): Promise<PolicyVersionRecord | null> {
  const row = await db.distributionPolicyVersion.findFirst({
    where: { id: versionId, restaurantId },
    select: versionSelect,
  });
  return row ? toRecord(row) : null;
}

/** Versión vigente del restaurante (null si el restaurante no existe o no tiene política). */
export async function getCurrentPolicy(
  db: DbClient,
  restaurantId: string,
): Promise<PolicyVersionRecord | null> {
  const restaurant = await getRestaurant(db, restaurantId);
  if (!restaurant?.currentPolicyVersionId) return null;
  return getPolicyVersion(db, restaurantId, restaurant.currentPolicyVersionId);
}

/** Historial: todas las versiones del restaurante, de la más nueva a la más vieja. */
export async function listPolicyVersions(
  db: DbClient,
  restaurantId: string,
): Promise<PolicyVersionRecord[]> {
  const rows = await db.distributionPolicyVersion.findMany({
    where: { restaurantId },
    select: versionSelect,
    orderBy: { number: 'desc' },
  });
  return rows.map(toRecord);
}

/** Períodos cerrados por versión (id de versión → cantidad). */
export async function countClosedPeriodsByVersion(
  db: DbClient,
  restaurantId: string,
): Promise<Map<string, number>> {
  const groups = await db.weeklySettlement.groupBy({
    by: ['policyVersionId'],
    where: { restaurantId, status: 'CLOSED' },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.policyVersionId, g._count._all]));
}

/** Personas activas por puesto (id del puesto → cantidad). */
export async function countPeopleByPosition(
  db: DbClient,
  restaurantId: string,
): Promise<Record<string, number>> {
  const groups = await db.employee.groupBy({
    by: ['defaultPositionId'],
    where: { restaurantId, active: true, archivedAt: null, defaultPositionId: { not: null } },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const g of groups) if (g.defaultPositionId) out[g.defaultPositionId] = g._count._all;
  return out;
}

const ORIGIN: Record<PolicyOrigin, ViewOrigin> = {
  STANDARD: 'ESTANDAR',
  COPY: 'COPIA',
  CHANGE: 'CAMBIO',
};

function toView(record: PolicyVersionRecord, closedPeriods: number): PolicyVersionView {
  return {
    number: record.number,
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdByName,
    origin: ORIGIN[record.origin],
    summary: record.summary,
    values: record.values,
    positions: record.positions.map((p) => ({ id: p.positionId, name: p.name, factor: p.factor })),
    closedPeriods,
  };
}

/** Todo lo que muestra "Configuración de distribución" para un restaurante. */
export async function getDistributionConfigView(
  db: DbClient,
  access: { restaurantId: string; canConfigure: boolean },
): Promise<DistributionConfigView | null> {
  const restaurant = await getRestaurant(db, access.restaurantId);
  if (!restaurant?.currentPolicyVersionId) return null;
  const [versions, closed, peopleByPosition] = await Promise.all([
    listPolicyVersions(db, access.restaurantId),
    countClosedPeriodsByVersion(db, access.restaurantId),
    countPeopleByPosition(db, access.restaurantId),
  ]);
  const views = versions.map((v) => toView(v, closed.get(v.id) ?? 0));
  const current = views.find((_, i) => versions[i]?.id === restaurant.currentPolicyVersionId);
  if (!current) return null;
  return {
    source: 'database',
    venueName: restaurant.name,
    current,
    versions: views,
    peopleByPosition,
    portionDisplay: restaurant.portionDisplay,
    canEdit: access.canConfigure,
  };
}
