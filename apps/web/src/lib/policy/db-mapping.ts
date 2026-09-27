/**
 * Traducción entre los valores de la pantalla (`DistributionConfig`, los mismos de la demo) y las
 * columnas tipadas de `distribution_policy_versions`. Los enums de la base solo tienen las
 * opciones que GUTIP ya calcula, así que una opción "próximamente" no tiene traducción.
 */
import type {
  AdvanceDeduction,
  EnvelopeHandlers,
  HoursBasis,
  HoursEntry,
  PeriodKind,
  PoolStructure,
  PortionMode,
  PotSources,
  RoundingUnit,
  SplitTiming,
} from '@prisma/client';
import { formatScaled, parseDecimal } from '@/lib/decimal';
import type { DistributionConfig } from '@/lib/demo-store/config';

/** Columnas de parámetros de una versión (sin número, autor, fecha ni puestos). */
export interface PolicyColumns {
  periodKind: PeriodKind;
  periodStartWeekday: number;
  splitTiming: SplitTiming;
  hoursBasis: HoursBasis;
  hoursEntry: HoursEntry;
  potSources: PotSources;
  poolStructure: PoolStructure;
  portionMode: PortionMode;
  roundingUnit: RoundingUnit;
  advanceDeduction: AdvanceDeduction;
  envelopeHandlers: EnvelopeHandlers;
}

type Pairs<K extends keyof DistributionConfig, V extends string> = readonly (readonly [
  DistributionConfig[K],
  V,
])[];

const PERIOD: Pairs<'period', PeriodKind> = [['SEMANAL', 'WEEKLY']];
const SPLIT: Pairs<'splitTiming', SplitTiming> = [['POR_PERIODO', 'PER_PERIOD']];
const HOURS_BASIS: Pairs<'hoursBasis', HoursBasis> = [['TOTAL_PERIODO', 'PERIOD_TOTAL']];
const HOURS_ENTRY: Pairs<'hoursEntry', HoursEntry> = [['TOTAL_AL_CERRAR', 'PERIOD_TOTAL_AT_CLOSE']];
const SOURCES: Pairs<'sources', PotSources> = [['UNA_FUENTE', 'SINGLE_DAILY_AMOUNT']];
const GROUPS: Pairs<'groups', PoolStructure> = [['SIN_GRUPOS', 'SINGLE_POOL']];
const WEIGHTS: Pairs<'weights', PortionMode> = [['POR_PUESTO', 'BY_POSITION']];
const ROUNDING: Pairs<'rounding', RoundingUnit> = [
  ['CENTAVO', 'CENT'],
  ['PESO', 'PESO'],
];
const ADVANCES: Pairs<'advances', AdvanceDeduction> = [['TODO_EL_PERIODO', 'WHOLE_PERIOD']];
const ENVELOPES: Pairs<'envelopes', EnvelopeHandlers> = [
  ['SOLO_ENCARGADO', 'MANAGER_ONLY'],
  ['ENCARGADO_Y_EDITOR', 'MANAGER_AND_EDITOR'],
];

function toDb<K extends keyof DistributionConfig, V extends string>(
  pairs: Pairs<K, V>,
  value: DistributionConfig[K],
  label: string,
): V {
  const found = pairs.find(([ui]) => ui === value);
  if (!found) throw new Error(`${label}: la opción ${value} todavía no se puede guardar.`);
  return found[1];
}

function fromDb<K extends keyof DistributionConfig, V extends string>(
  pairs: Pairs<K, V>,
  value: V,
  label: string,
): DistributionConfig[K] {
  const found = pairs.find(([, db]) => db === value);
  if (!found) throw new Error(`${label}: valor desconocido en la base (${value}).`);
  return found[0];
}

export function valuesToColumns(
  values: DistributionConfig,
  periodStartWeekday: number,
): PolicyColumns {
  return {
    periodKind: toDb(PERIOD, values.period, 'Período'),
    periodStartWeekday,
    splitTiming: toDb(SPLIT, values.splitTiming, 'Cuándo se reparte'),
    hoursBasis: toDb(HOURS_BASIS, values.hoursBasis, 'Horas'),
    hoursEntry: toDb(HOURS_ENTRY, values.hoursEntry, 'Carga de horas'),
    potSources: toDb(SOURCES, values.sources, 'Fuentes del pozo'),
    poolStructure: toDb(GROUPS, values.groups, 'Grupos'),
    portionMode: toDb(WEIGHTS, values.weights, 'Porción'),
    roundingUnit: toDb(ROUNDING, values.rounding, 'Redondeo'),
    advanceDeduction: toDb(ADVANCES, values.advances, 'Adelantos'),
    envelopeHandlers: toDb(ENVELOPES, values.envelopes, 'Sobres'),
  };
}

export function columnsToValues(columns: PolicyColumns): DistributionConfig {
  return {
    period: fromDb(PERIOD, columns.periodKind, 'Período'),
    splitTiming: fromDb(SPLIT, columns.splitTiming, 'Cuándo se reparte'),
    hoursBasis: fromDb(HOURS_BASIS, columns.hoursBasis, 'Horas'),
    hoursEntry: fromDb(HOURS_ENTRY, columns.hoursEntry, 'Carga de horas'),
    sources: fromDb(SOURCES, columns.potSources, 'Fuentes del pozo'),
    groups: fromDb(GROUPS, columns.poolStructure, 'Grupos'),
    weights: fromDb(WEIGHTS, columns.portionMode, 'Porción'),
    rounding: fromDb(ROUNDING, columns.roundingUnit, 'Redondeo'),
    advances: fromDb(ADVANCES, columns.advanceDeduction, 'Adelantos'),
    envelopes: fromDb(ENVELOPES, columns.envelopeHandlers, 'Sobres'),
  };
}

/** Escala de la porción en la base: NUMERIC(20,10). */
export const PORTION_DB_SCALE = 10;

/** Porción escrita en la pantalla ("0,022") → texto para NUMERIC(20,10) ("0.0220000000"). */
export function portionToDb(factor: string): string {
  const scaled = parseDecimal(factor, PORTION_DB_SCALE);
  if (scaled === null || scaled <= 0n) throw new Error(`Porción inválida: ${factor}`);
  return formatScaled(scaled, PORTION_DB_SCALE, PORTION_DB_SCALE)
    .replace(/\./g, '')
    .replace(',', '.');
}

/** Porción de la base ("0.0220000000", sin floats) → como se muestra en la pantalla ("0,022"). */
export function portionFromDb(portion: string): string {
  const scaled = parseDecimal(portion, PORTION_DB_SCALE);
  if (scaled === null) throw new Error(`Porción inválida en la base: ${portion}`);
  const text = formatScaled(scaled, PORTION_DB_SCALE, PORTION_DB_SCALE);
  return text.replace(/0+$/, '').replace(/,$/, '');
}
