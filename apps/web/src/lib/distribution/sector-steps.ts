/**
 * Reparto POR SECTORES, paso a paso (`pool_structure = STAGED_SECTORS`, con sectores propios en
 * `policy_version_sectors`). Funciones PURAS.
 *
 * Un sector tiene nombre, porcentaje, base y los puestos que incluye (ninguno, uno o varios). Los
 * sectores se calculan EN ORDEN y cada uno elige su base:
 *
 *   TOTAL      el total original de la propina      Cocina 30 % de $100.000 = $30.000 (quedan $70.000)
 *   REMAINDER  el saldo que queda en ese paso       Salón 50 % de $70.000 = $35.000   (quedan $35.000)
 *
 * Nunca se reparte más de lo que queda: una configuración en la que un sector "del total" pide más
 * que el saldo no se puede guardar (lo dice `checkSectors`). Lo que queda después del último sector
 * es plata SIN ASIGNAR: se informa con su monto, no pasa a ningún sector y no se reparte sola.
 *
 * Después, el monto de cada sector se reparte entre la gente de SUS puestos con el motor de
 * participación (porción del puesto, horas y puntos individuales: lo que ya está en "Puestos y
 * porciones" y "Personal"). Un sector sin puestos recibe su monto como sector (se le entrega
 * entero, sin reparto por persona en GUTIP).
 *
 * Aritmética exacta en la unidad de redondeo (centavo o peso): el monto de cada sector se redondea
 * half-up a la unidad, así cada saldo es múltiplo de la unidad y nada se pierde.
 */
import { divRoundHalfUp } from '@/lib/decimal';
import { formatStagePercent, parseStagePercent } from './sector-stages';

export { formatStagePercent as formatSectorPercent, parseStagePercent as parseSectorPercent };

/** Máximo de sectores (Cocina, Salón, Bacha… alcanza con margen). La base admite hasta 9. */
export const MAX_SECTORS = 8;
/** Largo máximo del nombre de un sector (la base admite hasta 60). */
export const MAX_SECTOR_NAME = 40;
const HUNDRED_E2 = 10_000n;

export type SectorBase = 'TOTAL' | 'REMAINDER';

/** Un sector tal como lo escribe el usuario (o lo guarda una versión de la política). */
export interface SectorInput {
  id: string;
  name: string;
  base: SectorBase;
  /** Porcentaje escrito ("30", "12,5"); null = sin cargar. */
  percent: string | null;
  /** Puestos que cobran dentro del sector (ids de `positions`). Vacío = cobra el sector entero. */
  positionIds: readonly string[];
}

/** Un sector como lo guarda una versión de la política (sin sus puestos). */
export interface PolicySector {
  id: string;
  name: string;
  base: SectorBase;
  /** Porcentaje como se muestra ("30", "12,5"). */
  percent: string;
}

/**
 * Los sectores de una versión con sus puestos (cada puesto dice en qué sector cobra). Una versión
 * sin sectores propios pero con puestos en etapas es del formato anterior (`isLegacySectors`).
 */
export function sectorInputs(
  sectors: readonly PolicySector[],
  positions: readonly { id: string; sectorId?: string | null }[],
): SectorInput[] {
  return sectors.map((s) => ({
    ...s,
    positionIds: positions.filter((p) => p.sectorId === s.id).map((p) => p.id),
  }));
}

/** Versión guardada con el formato anterior: puestos con etapa y ningún sector propio. */
export function isLegacySectors(
  sectors: readonly unknown[] | undefined,
  positions: readonly { stage?: number | null }[],
): boolean {
  return (sectors?.length ?? 0) === 0 && positions.some((p) => (p.stage ?? null) !== null);
}

export interface SectorPlan {
  id: string;
  name: string;
  base: SectorBase;
  percentE2: bigint;
  positionIds: string[];
}

export type SectorsCheck =
  | {
      ok: true;
      sectors: SectorPlan[];
      /** Parte del total que queda sin asignar después del último sector (0 = se reparte todo). */
      leftover: Fraction;
    }
  | { ok: false; errors: string[] };

/** Fracción exacta del total (num / den). */
export interface Fraction {
  num: bigint;
  den: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
const reduce = ({ num, den }: Fraction): Fraction => {
  const g = gcd(num, den);
  return g > 1n ? { num: num / g, den: den / g } : { num, den };
};

/** Fracción del total → "35" / "12,5" / "33,33" (hacia abajo, a 2 decimales). */
export function fractionPercentText(fraction: Fraction): string {
  return formatStagePercent((fraction.num * HUNDRED_E2) / fraction.den);
}

/** "del total" / "del saldo". */
export function sectorBaseLabel(base: SectorBase): string {
  return base === 'TOTAL' ? 'del total' : 'del saldo';
}

/** "del total original" / "del saldo que quedaba", para explicar la base en una oración. */
export function sectorBaseLong(base: SectorBase): string {
  return base === 'TOTAL' ? 'del total original' : 'del saldo que quedaba';
}

/** Fracción del total que se lleva un sector y la que queda, sobre la fracción que quedaba. */
function take(left: Fraction, base: SectorBase, percentE2: bigint): Fraction | null {
  if (base === 'TOTAL') {
    // percent/100 del total; tiene que entrar en lo que queda.
    if (percentE2 * left.den > left.num * HUNDRED_E2) return null;
    return reduce({
      num: left.num * HUNDRED_E2 - percentE2 * left.den,
      den: left.den * HUNDRED_E2,
    });
  }
  return reduce({ num: left.num * (HUNDRED_E2 - percentE2), den: left.den * HUNDRED_E2 });
}

/**
 * Valida la configuración completa y la deja lista para calcular. Devuelve TODOS los errores, con
 * mensajes para el usuario. `positions` son los puestos de la versión: un puesto puede estar en un
 * solo sector; uno que no está en ninguno no cobra por sectores (se avisa al repartir).
 */
export function checkSectors(
  sectors: readonly SectorInput[],
  positions: readonly { id: string; name: string }[],
): SectorsCheck {
  const errors: string[] = [];
  if (sectors.length === 0) return { ok: false, errors: ['Agregá al menos un sector.'] };
  if (sectors.length > MAX_SECTORS) {
    errors.push(`Puede haber hasta ${MAX_SECTORS} sectores.`);
  }
  const known = new Map(positions.map((p) => [p.id, p.name]));
  const owner = new Map<string, string>();
  const names = new Set<string>();
  const valid: SectorPlan[] = [];
  sectors.forEach((sector, index) => {
    const name = sector.name.trim();
    const label = name === '' ? `El sector ${index + 1}` : name;
    if (name === '') errors.push(`${label}: poné un nombre (por ejemplo, Cocina).`);
    else if (name.length > MAX_SECTOR_NAME) {
      errors.push(`${label}: el nombre puede tener hasta ${MAX_SECTOR_NAME} letras.`);
    } else if (names.has(name.toLowerCase())) {
      errors.push(`Hay dos sectores que se llaman "${name}": cambiale el nombre a uno.`);
    }
    names.add(name.toLowerCase());
    const percentE2 = parseStagePercent(sector.percent);
    if (percentE2 === null) {
      errors.push(
        sector.percent === null || sector.percent.trim() === ''
          ? `${label}: falta el porcentaje.`
          : `${label}: el porcentaje tiene que ser un número mayor que 0 y hasta 100 (hasta 2 decimales).`,
      );
    }
    if (sector.base !== 'TOTAL' && sector.base !== 'REMAINDER') {
      errors.push(`${label}: elegí si se calcula sobre el total o sobre el saldo.`);
    }
    for (const positionId of sector.positionIds) {
      const positionName = known.get(positionId);
      if (positionName === undefined) {
        errors.push(`${label}: uno de sus puestos ya no existe. Recargá la página.`);
        continue;
      }
      const other = owner.get(positionId);
      if (other !== undefined) {
        errors.push(
          `${positionName} está en ${other} y en ${label}: un puesto va en un solo sector.`,
        );
      }
      owner.set(positionId, label);
    }
    if (percentE2 !== null) {
      valid.push({
        id: sector.id,
        name,
        // El primer sector siempre parte del total (el saldo todavía es el total).
        base: index === 0 ? 'TOTAL' : sector.base,
        percentE2,
        positionIds: [...new Set(sector.positionIds)],
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  let left: Fraction = { num: 1n, den: 1n };
  for (const sector of valid) {
    const next = take(left, sector.base, sector.percentE2);
    if (next === null) {
      errors.push(
        `${sector.name} pide el ${formatStagePercent(sector.percentE2)} % del total, pero en ese paso solo queda el ${fractionPercentText(left)} % del total. Bajá su porcentaje o calculalo sobre el saldo.`,
      );
      break;
    }
    left = next;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, sectors: valid, leftover: left };
}

export interface SectorResult {
  id: string;
  name: string;
  base: SectorBase;
  percentE2: bigint;
  positionIds: string[];
  /** Sobre qué monto se calcula el porcentaje (el total o el saldo de ese paso). */
  baseCents: bigint;
  /** Lo que quedaba antes de este sector. */
  availableCents: bigint;
  amountCents: bigint;
  /** Lo que queda después de este sector. */
  leftAfterCents: bigint;
}

/**
 * Calcula el monto de cada sector, en orden. `sectors` sale de `checkSectors` (o de
 * `partialSectors` para un resumen en vivo). `totalCents` tiene que ser múltiplo de la unidad.
 */
export function computeSectors(
  totalCents: bigint,
  sectors: readonly SectorPlan[],
  unitCents: bigint = 1n,
): SectorResult[] {
  if (totalCents < 0n) throw new Error('El total no puede ser negativo.');
  if (unitCents <= 0n || totalCents % unitCents !== 0n) {
    throw new Error('El total tiene que ser múltiplo de la unidad de redondeo.');
  }
  const totalUnits = totalCents / unitCents;
  let left = totalUnits;
  return sectors.map((sector) => {
    const baseUnits = sector.base === 'TOTAL' ? totalUnits : left;
    // El redondeo nunca puede llevarse más de lo que queda (solo pasa en el límite exacto).
    const rounded = divRoundHalfUp(baseUnits * sector.percentE2, HUNDRED_E2);
    const amount = rounded > left ? left : rounded;
    const result: SectorResult = {
      id: sector.id,
      name: sector.name,
      base: sector.base,
      percentE2: sector.percentE2,
      positionIds: sector.positionIds,
      baseCents: baseUnits * unitCents,
      availableCents: left * unitCents,
      amountCents: amount * unitCents,
      leftAfterCents: (left - amount) * unitCents,
    };
    left -= amount;
    return result;
  });
}

/** Lo que queda sin asignar después del último sector. */
export function sectorsLeftover(
  totalCents: bigint | string,
  results: readonly { leftAfterCents: bigint | string }[],
): bigint {
  const last = results[results.length - 1];
  return last ? BigInt(last.leftAfterCents) : BigInt(totalCents);
}

/**
 * Sectores que ya se pueden calcular mientras se completa la configuración (resumen en vivo): los
 * primeros, en orden, hasta el primero sin porcentaje válido o que pide más de lo que queda. No
 * reemplaza a `checkSectors`: guardar y repartir siguen exigiendo la configuración completa.
 */
export function partialSectors(sectors: readonly SectorInput[]): SectorPlan[] {
  const out: SectorPlan[] = [];
  let left: Fraction = { num: 1n, den: 1n };
  for (const [index, sector] of sectors.entries()) {
    const percentE2 = parseStagePercent(sector.percent);
    if (percentE2 === null) break;
    const base: SectorBase = index === 0 ? 'TOTAL' : sector.base;
    const next = take(left, base, percentE2);
    if (next === null) break;
    left = next;
    out.push({
      id: sector.id,
      name: sector.name.trim() || `Sector ${index + 1}`,
      base,
      percentE2,
      positionIds: [...sector.positionIds],
    });
  }
  return out;
}

/** "Cocina 30 % del total · Salón 50 % del saldo (Camarero, Barra) · Bacha 100 % del saldo". */
export function sectorsSummary(
  sectors: readonly SectorPlan[],
  positionName: (id: string) => string,
): string {
  return sectors
    .map((s) => {
      const positions = s.positionIds.map(positionName).join(', ');
      return `${s.name} ${formatStagePercent(s.percentE2)} % ${sectorBaseLabel(s.base)}${
        positions ? ` (${positions})` : ''
      }`;
    })
    .join(' · ');
}
