import { EngineError } from './errors';

/** ISO calendar date, "YYYY-MM-DD". All date arithmetic uses BigInt (no Date, no Number). */
export type IsoDate = string;

/** 1 = Monday ... 7 = Sunday */
export type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeekRange {
  weekStart: IsoDate;
  weekEnd: IsoDate;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const VALID_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_BY_VALUE = new Map<bigint, WeekdayNumber>([
  [1n, 1],
  [2n, 2],
  [3n, 3],
  [4n, 4],
  [5n, 5],
  [6n, 6],
  [7n, 7],
]);

// Civil <-> epoch-day conversion (proleptic Gregorian, years >= 1). Epoch day 0 = 1970-01-01.
function daysFromCivil(year: bigint, month: bigint, day: bigint): bigint {
  const y = month <= 2n ? year - 1n : year;
  const era = y / 400n;
  const yoe = y - era * 400n;
  const doy = (153n * (month > 2n ? month - 3n : month + 9n) + 2n) / 5n + day - 1n;
  const doe = yoe * 365n + yoe / 4n - yoe / 100n + doy;
  return era * 146097n + doe - 719468n;
}

function civilFromDays(epochDay: bigint): { year: bigint; month: bigint; day: bigint } {
  const z = epochDay + 719468n;
  const era = z / 146097n;
  const doe = z - era * 146097n;
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const day = doy - (153n * mp + 2n) / 5n + 1n;
  const month = mp < 10n ? mp + 3n : mp - 9n;
  const year = yoe + era * 400n + (month <= 2n ? 1n : 0n);
  return { year, month, day };
}

function pad(value: bigint, width: number): string {
  return value.toString().padStart(width, '0');
}

function toIso(epochDay: bigint): IsoDate {
  const { year, month, day } = civilFromDays(epochDay);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function toEpochDay(date: IsoDate): bigint {
  const match = typeof date === 'string' ? ISO_DATE_PATTERN.exec(date) : null;
  if (!match) {
    throw new EngineError('INVALID_DATE', `Invalid date (expected YYYY-MM-DD): "${String(date)}"`);
  }
  const year = BigInt(match[1] ?? '0');
  const month = BigInt(match[2] ?? '0');
  const day = BigInt(match[3] ?? '0');
  if (year < 1n || month < 1n || month > 12n || day < 1n || day > 31n) {
    throw new EngineError('INVALID_DATE', `Invalid date: "${date}"`);
  }
  const epochDay = daysFromCivil(year, month, day);
  const back = civilFromDays(epochDay);
  if (back.year !== year || back.month !== month || back.day !== day) {
    throw new EngineError('INVALID_DATE', `Date does not exist in the calendar: "${date}"`);
  }
  return epochDay;
}

export function assertIsoDate(date: IsoDate): void {
  toEpochDay(date);
}

export function isValidIsoDate(date: IsoDate): boolean {
  try {
    toEpochDay(date);
    return true;
  } catch {
    return false;
  }
}

/** Adds (or subtracts, if negative) whole days. */
export function addDays(date: IsoDate, days: bigint): IsoDate {
  return toIso(toEpochDay(date) + days);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: IsoDate): WeekdayNumber {
  const epochDay = toEpochDay(date);
  // 1970-01-01 was a Thursday (ISO 4).
  const weekday = WEEKDAY_BY_VALUE.get(((((epochDay + 3n) % 7n) + 7n) % 7n) + 1n);
  if (weekday === undefined) {
    throw new EngineError('INTERNAL_INVARIANT', 'Weekday computation out of range');
  }
  return weekday;
}

/** Week containing `date`, given the weekday on which the restaurant's week starts. */
export function weekRange(date: IsoDate, weekStartsOn: WeekdayNumber = 1): WeekRange {
  if (!VALID_WEEKDAYS.includes(weekStartsOn)) {
    throw new EngineError('INVALID_DATE', `weekStartsOn must be 1..7, got ${String(weekStartsOn)}`);
  }
  const epochDay = toEpochDay(date);
  const weekday = BigInt(isoWeekday(date));
  const offset = (weekday - BigInt(weekStartsOn) + 7n) % 7n;
  const start = epochDay - offset;
  return { weekStart: toIso(start), weekEnd: toIso(start + 6n) };
}

/** Every date from `start` to `end`, inclusive. */
export function datesInRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const first = toEpochDay(start);
  const last = toEpochDay(end);
  const dates: IsoDate[] = [];
  for (let day = first; day <= last; day += 1n) {
    dates.push(toIso(day));
  }
  return dates;
}
