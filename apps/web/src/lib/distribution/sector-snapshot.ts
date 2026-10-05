/**
 * Resultado del reparto por sectores, tal como viaja a la pantalla y como queda guardado en el
 * snapshot del cierre (`weekly_settlements.policy_snapshot.sectorStages`). Sin bigint: importes en
 * texto de centavos y porcentajes en texto E2 ("3000" = 30 %).
 *
 * El historial lee este snapshot y NO recalcula: un reparto viejo se ve tal como se cerró.
 */
import type { StageBase, StageResult } from './sector-stages';

// Alias (no interfaces): así son asignables a un campo JSON de Prisma.
export type SectorView = {
  /** Id del puesto. */
  id: string;
  name: string;
  percentE2: string;
  amountCents: string;
  /** Personas del sector que cobraron (con horas). */
  people: number;
};

export type SectorStageView = {
  number: number;
  base: StageBase;
  baseCents: string;
  /** Σ de porcentajes de la etapa (E2). */
  percentE2: string;
  amountCents: string;
  remainderCents: string;
  sectors: SectorView[];
};

/** Resultado del cálculo → vista (y snapshot). `people`: personas con horas por sector. */
export function stagesToView(
  stages: readonly StageResult[],
  people: ReadonlyMap<string, number>,
): SectorStageView[] {
  return stages.map((stage) => ({
    number: stage.number,
    base: stage.base,
    baseCents: stage.baseCents.toString(),
    percentE2: stage.percentE2.toString(),
    amountCents: stage.amountCents.toString(),
    remainderCents: stage.remainderCents.toString(),
    sectors: stage.sectors.map((sector) => ({
      id: sector.id,
      name: sector.name,
      percentE2: sector.percentE2.toString(),
      amountCents: sector.amountCents.toString(),
      people: people.get(sector.id) ?? 0,
    })),
  }));
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);

/**
 * Lee `sectorStages` de un snapshot guardado. null si el reparto no fue por sectores o el dato no
 * tiene la forma esperada (nunca rompe la pantalla de un reparto viejo).
 */
export function parseSectorSnapshot(snapshot: unknown): SectorStageView[] | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const raw = (snapshot as { sectorStages?: unknown }).sectorStages;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const stages: SectorStageView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const s = item as Record<string, unknown>;
    if (
      typeof s.number !== 'number' ||
      (s.base !== 'TOTAL' && s.base !== 'REMAINDER') ||
      !isText(s.baseCents) ||
      !isText(s.percentE2) ||
      !isText(s.amountCents) ||
      !isText(s.remainderCents) ||
      !Array.isArray(s.sectors)
    ) {
      return null;
    }
    const sectors: SectorView[] = [];
    for (const entry of s.sectors) {
      if (!entry || typeof entry !== 'object') return null;
      const x = entry as Record<string, unknown>;
      if (
        typeof x.id !== 'string' ||
        typeof x.name !== 'string' ||
        !isText(x.percentE2) ||
        !isText(x.amountCents) ||
        typeof x.people !== 'number'
      ) {
        return null;
      }
      sectors.push({
        id: x.id,
        name: x.name,
        percentE2: x.percentE2,
        amountCents: x.amountCents,
        people: x.people,
      });
    }
    stages.push({
      number: s.number,
      base: s.base,
      baseCents: s.baseCents,
      percentE2: s.percentE2,
      amountCents: s.amountCents,
      remainderCents: s.remainderCents,
      sectors,
    });
  }
  return stages;
}
