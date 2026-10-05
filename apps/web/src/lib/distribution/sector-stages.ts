/**
 * Reparto POR SECTORES, EN ETAPAS (`pool_structure = STAGED_SECTORS`). Funciones PURAS.
 *
 * Cada puesto de la política es un sector con una etapa y un porcentaje. Las etapas se calculan en
 * orden y cada una usa una base distinta:
 *
 *   ETAPA 1      base = TOTAL de la propina           p. ej. Cocina 30 % de $100.000 = $30.000
 *   ETAPA 2…N    base = SALDO que dejó la anterior    p. ej. Salón 60 % de $70.000 = $42.000
 *
 * Una etapa intermedia suma MENOS de 100 % de su base (lo que queda es la base de la siguiente) y la
 * última suma EXACTAMENTE 100 %: así se reparte todo y la suma de los sectores es el total.
 * Después, el monto de cada sector se reparte entre su gente con el motor de participación
 * (`computePool`): el sector es un pozo.
 *
 * Aritmética exacta en la unidad de redondeo (centavo o peso): el monto de una etapa intermedia se
 * redondea half-up y se divide entre sus sectores por mayor resto, así cada etapa y cada saldo son
 * múltiplos de la unidad y nada se pierde.
 */
import { divRoundHalfUp, formatScaled, parseDecimal } from '@/lib/decimal';

/** Porcentajes de etapa: hasta 2 decimales ("12,5" → 1250n). */
export const STAGE_PERCENT_SCALE = 2;
/** Máximo de etapas (cocina, salón, bacha… alcanza con margen). La base admite hasta 9. */
export const MAX_STAGES = 5;
const HUNDRED_E2 = 100n * 10n ** BigInt(STAGE_PERCENT_SCALE);

export type StageBase = 'TOTAL' | 'REMAINDER';

/** Un sector tal como lo define la política: el puesto con su etapa y porcentaje. */
export interface SectorAssignment {
  /** Id del puesto (`positions.id`). */
  id: string;
  name: string;
  /** Etapa 1…MAX_STAGES; null = sin asignar. */
  stage: number | null;
  /** Porcentaje escrito ("30", "12,5"); null = sin cargar. */
  percent: string | null;
}

export interface StageSector {
  id: string;
  name: string;
  percentE2: bigint;
}

export interface StagePlan {
  number: number;
  base: StageBase;
  sectors: StageSector[];
  /** Σ de los porcentajes de la etapa (E2). */
  sumE2: bigint;
}

export type StagesCheck = { ok: true; stages: StagePlan[] } | { ok: false; errors: string[] };

/** Porcentaje escrito → E2; null si no es un número mayor que 0 y hasta 100 (2 decimales). */
export function parseStagePercent(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null;
  const value = parseDecimal(text.replace(/%\s*$/, ''), STAGE_PERCENT_SCALE);
  return value !== null && value > 0n && value <= HUNDRED_E2 ? value : null;
}

/** E2 → "30" / "12,5" / "33,33" (sin ceros de más). */
export function formatStagePercent(percentE2: bigint): string {
  return formatScaled(percentE2, STAGE_PERCENT_SCALE, STAGE_PERCENT_SCALE)
    .replace(/,?0+$/, '')
    .replace(/,$/, '');
}

/** "sobre el total" / "sobre el saldo restante". */
export function stageBaseLabel(base: StageBase): string {
  return base === 'TOTAL' ? 'sobre el total' : 'sobre el saldo restante';
}

/**
 * Valida la configuración completa y la ordena en etapas. Devuelve TODOS los errores, con mensajes
 * para el usuario: qué sector está incompleto y qué etapa no cierra (y por cuánto).
 */
export function checkStages(sectors: readonly SectorAssignment[]): StagesCheck {
  const errors: string[] = [];
  if (sectors.length === 0) {
    return { ok: false, errors: ['Definí al menos un puesto para repartir por sectores.'] };
  }
  const valid: { sector: SectorAssignment; stage: number; percentE2: bigint }[] = [];
  for (const sector of sectors) {
    const stage = sector.stage;
    const stageOk = stage !== null && Number.isInteger(stage) && stage >= 1 && stage <= MAX_STAGES;
    const percentE2 = parseStagePercent(sector.percent);
    if (!stageOk) {
      errors.push(
        stage === null
          ? `${sector.name}: elegí en qué etapa cobra.`
          : `${sector.name}: la etapa tiene que ser de 1 a ${MAX_STAGES}.`,
      );
    }
    if (percentE2 === null) {
      errors.push(
        sector.percent === null || sector.percent.trim() === ''
          ? `${sector.name}: falta el porcentaje.`
          : `${sector.name}: el porcentaje tiene que ser un número mayor que 0 y hasta 100 (hasta 2 decimales).`,
      );
    }
    if (stageOk && percentE2 !== null) valid.push({ sector, stage: stage as number, percentE2 });
  }
  if (errors.length > 0) return { ok: false, errors };

  const last = Math.max(...valid.map((v) => v.stage));
  const stages: StagePlan[] = [];
  for (let number = 1; number <= last; number += 1) {
    const members = valid.filter((v) => v.stage === number);
    if (members.length === 0) {
      errors.push(
        `La etapa ${number} no tiene ningún sector: numerá las etapas 1, 2, 3… sin saltos.`,
      );
      continue;
    }
    const sumE2 = members.reduce((sum, m) => sum + m.percentE2, 0n);
    const base: StageBase = number === 1 ? 'TOTAL' : 'REMAINDER';
    const where = base === 'TOTAL' ? 'del total' : 'del saldo';
    if (number < last && sumE2 >= HUNDRED_E2) {
      errors.push(
        `La etapa ${number} suma ${formatStagePercent(sumE2)} % ${where} y después viene la etapa ${number + 1}: tiene que sumar menos de 100 % para que quede saldo.`,
      );
    }
    if (number === last && sumE2 !== HUNDRED_E2) {
      const diff = sumE2 < HUNDRED_E2 ? HUNDRED_E2 - sumE2 : sumE2 - HUNDRED_E2;
      errors.push(
        `La última etapa (${number}) suma ${formatStagePercent(sumE2)} % ${where}: tiene que sumar exactamente 100 % para que se reparta todo (${sumE2 < HUNDRED_E2 ? 'faltan' : 'sobran'} ${formatStagePercent(diff)} %).`,
      );
    }
    stages.push({
      number,
      base,
      sumE2,
      sectors: members.map((m) => ({
        id: m.sector.id,
        name: m.sector.name,
        percentE2: m.percentE2,
      })),
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, stages };
}

export interface SectorAmount {
  id: string;
  name: string;
  stage: number;
  percentE2: bigint;
  /** Base de su etapa (total o saldo). */
  baseCents: bigint;
  amountCents: bigint;
}

export interface StageResult {
  number: number;
  base: StageBase;
  baseCents: bigint;
  /** Σ de porcentajes de la etapa (E2). */
  percentE2: bigint;
  /** Lo que reparte la etapa entre sus sectores. */
  amountCents: bigint;
  /** Saldo que queda para la etapa siguiente (0 en la última). */
  remainderCents: bigint;
  sectors: SectorAmount[];
}

/** Reparte `units` por mayor resto según `weights` (empates: mayor peso, luego el orden). */
function largestRemainder(units: bigint, weights: readonly bigint[]): bigint[] {
  const total = weights.reduce((sum, w) => sum + w, 0n);
  if (total === 0n) return weights.map(() => 0n);
  const parts = weights.map((weight, index) => ({
    index,
    weight,
    base: (units * weight) / total,
    remainder: (units * weight) % total,
  }));
  const out = parts.map((p) => p.base);
  let leftover = units - out.reduce((sum, value) => sum + value, 0n);
  const ranked = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.weight !== b.weight) return a.weight > b.weight ? -1 : 1;
    return a.index - b.index;
  });
  for (const part of ranked) {
    if (leftover === 0n) break;
    out[part.index] = (out[part.index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return out;
}

/**
 * Calcula cada etapa sobre su base. `stages` sale de `checkStages` (ya válido). La suma de los
 * sectores es exactamente `totalCents`, que tiene que ser múltiplo de la unidad de redondeo.
 */
export function computeStages(
  totalCents: bigint,
  stages: readonly StagePlan[],
  unitCents: bigint = 1n,
): StageResult[] {
  if (totalCents < 0n) throw new Error('El total no puede ser negativo.');
  if (unitCents <= 0n || totalCents % unitCents !== 0n) {
    throw new Error('El total tiene que ser múltiplo de la unidad de redondeo.');
  }
  let baseUnits = totalCents / unitCents;
  return stages.map((stage, index) => {
    const isLast = index === stages.length - 1;
    const stageUnits = isLast ? baseUnits : divRoundHalfUp(baseUnits * stage.sumE2, HUNDRED_E2);
    const split = largestRemainder(
      stageUnits,
      stage.sectors.map((s) => s.percentE2),
    );
    const result: StageResult = {
      number: stage.number,
      base: stage.base,
      baseCents: baseUnits * unitCents,
      percentE2: stage.sumE2,
      amountCents: stageUnits * unitCents,
      remainderCents: (baseUnits - stageUnits) * unitCents,
      sectors: stage.sectors.map((sector, i) => ({
        id: sector.id,
        name: sector.name,
        stage: stage.number,
        percentE2: sector.percentE2,
        baseCents: baseUnits * unitCents,
        amountCents: (split[i] ?? 0n) * unitCents,
      })),
    };
    baseUnits -= stageUnits;
    return result;
  });
}

/** Resumen de una configuración válida: "Etapa 1 (sobre el total): Cocina 30 % · Etapa 2 …". */
export function stagesSummary(stages: readonly StagePlan[]): string {
  return stages
    .map(
      (stage) =>
        `Etapa ${stage.number} (${stageBaseLabel(stage.base)}): ${stage.sectors
          .map((s) => `${s.name} ${formatStagePercent(s.percentE2)} %`)
          .join(', ')}`,
    )
    .join(' · ');
}
