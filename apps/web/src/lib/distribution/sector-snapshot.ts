/**
 * Resultado del reparto por sectores, tal como viaja a la pantalla y como queda guardado en el
 * snapshot del cierre (`weekly_settlements.policy_snapshot`). Sin bigint: importes en texto de
 * centavos y porcentajes en texto E2 ("3000" = 30 %).
 *
 * Dos formatos:
 * - `sectorSteps` (actual): sectores en orden, cada uno con su base (total o saldo), sus puestos y
 *   lo que queda después; al final, lo sin asignar.
 * - `sectorStages` (repartos cerrados antes del 2026-10-05): cada puesto era un sector en una etapa.
 *
 * El historial lee este snapshot y NO recalcula: un reparto viejo se ve tal como se cerró.
 */
import type { SectorBase, SectorResult } from './sector-steps';
import type { StageBase } from './sector-stages';

// ─── Formato actual ──────────────────────────────────────────────────────────────────────────

export type SectorStepView = {
  /** Id del sector en su versión de la política. */
  id: string;
  name: string;
  base: SectorBase;
  percentE2: string;
  baseCents: string;
  availableCents: string;
  amountCents: string;
  leftAfterCents: string;
  /** Nombres de los puestos del sector (vacío = cobra el sector entero). */
  positions: string[];
  /** Personas del sector que cobraron (con horas). */
  people: number;
};

export type SectorStepsView = {
  totalCents: string;
  steps: SectorStepView[];
  /** Lo que quedó sin asignar después del último sector. */
  unassignedCents: string;
};

/** Lo que muestran las pantallas: el formato actual o el de los repartos viejos. */
export type SectorsSummary =
  ({ kind: 'steps' } & SectorStepsView) | { kind: 'stages'; stages: SectorStageView[] };

/** Resultado del cálculo → vista (y snapshot). */
export function stepsToView(
  totalCents: bigint,
  results: readonly SectorResult[],
  positionName: (id: string) => string,
  people: ReadonlyMap<string, number>,
): SectorStepsView {
  const last = results[results.length - 1];
  return {
    totalCents: totalCents.toString(),
    unassignedCents: (last ? last.leftAfterCents : totalCents).toString(),
    steps: results.map((r) => ({
      id: r.id,
      name: r.name,
      base: r.base,
      percentE2: r.percentE2.toString(),
      baseCents: r.baseCents.toString(),
      availableCents: r.availableCents.toString(),
      amountCents: r.amountCents.toString(),
      leftAfterCents: r.leftAfterCents.toString(),
      positions: r.positionIds.map(positionName),
      people: people.get(r.id) ?? 0,
    })),
  };
}

/**
 * Cada sector como un pozo, para "¿Cómo se calculó?": su monto y los puestos cuya gente cobra de
 * él (por nombre, como quedan en las filas del reparto). Los sectores sin puestos no tienen gente.
 */
export function sectorPools(
  summary: SectorsSummary,
): { id: string; name: string; amountCents: bigint; positionNames: string[] }[] {
  if (summary.kind === 'steps') {
    return summary.steps.map((s) => ({
      id: s.id,
      name: s.name,
      amountCents: BigInt(s.amountCents),
      positionNames: s.positions,
    }));
  }
  return summary.stages
    .flatMap((stage) => stage.sectors)
    .map((s) => ({
      id: s.id,
      name: s.name,
      amountCents: BigInt(s.amountCents),
      positionNames: [s.name],
    }));
}

/** Lo que cobraron los sectores SIN puestos (se entrega al sector entero, no va en sobres). */
export function sectorOnlyCents(summary: SectorsSummary | null): bigint {
  if (!summary || summary.kind !== 'steps') return 0n;
  return summary.steps
    .filter((s) => s.positions.length === 0)
    .reduce((sum, s) => sum + BigInt(s.amountCents), 0n);
}

// ─── Formato anterior (solo lectura) ─────────────────────────────────────────────────────────

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

const isText = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);

/**
 * Lee el reparto por sectores de un snapshot guardado (formato actual o anterior). null si el
 * reparto no fue por sectores o el dato no tiene la forma esperada (nunca rompe la pantalla).
 */
export function parseSectorSnapshot(snapshot: unknown): SectorsSummary | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const steps = parseSteps((snapshot as { sectorSteps?: unknown }).sectorSteps);
  if (steps) return { kind: 'steps', ...steps };
  const stages = parseStages((snapshot as { sectorStages?: unknown }).sectorStages);
  return stages ? { kind: 'stages', stages } : null;
}

function parseSteps(raw: unknown): SectorStepsView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isText(r.totalCents) || !isText(r.unassignedCents) || !Array.isArray(r.steps)) return null;
  const steps: SectorStepView[] = [];
  for (const item of r.steps) {
    if (!item || typeof item !== 'object') return null;
    const s = item as Record<string, unknown>;
    if (
      typeof s.id !== 'string' ||
      typeof s.name !== 'string' ||
      (s.base !== 'TOTAL' && s.base !== 'REMAINDER') ||
      !isText(s.percentE2) ||
      !isText(s.baseCents) ||
      !isText(s.availableCents) ||
      !isText(s.amountCents) ||
      !isText(s.leftAfterCents) ||
      !Array.isArray(s.positions) ||
      !s.positions.every((p) => typeof p === 'string') ||
      typeof s.people !== 'number'
    ) {
      return null;
    }
    steps.push({
      id: s.id,
      name: s.name,
      base: s.base,
      percentE2: s.percentE2,
      baseCents: s.baseCents,
      availableCents: s.availableCents,
      amountCents: s.amountCents,
      leftAfterCents: s.leftAfterCents,
      positions: s.positions as string[],
      people: s.people,
    });
  }
  return steps.length > 0
    ? { totalCents: r.totalCents, unassignedCents: r.unassignedCents, steps }
    : null;
}

function parseStages(raw: unknown): SectorStageView[] | null {
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
