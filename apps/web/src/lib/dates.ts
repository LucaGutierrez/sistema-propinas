/*
 * Fechas de calendario ("2024-11-23") sin zona horaria: se opera en UTC para que un día nunca
 * se corra por el huso horario del navegador.
 */

const LONG = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const SHORT = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY_MONTH = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const WEEKDAY = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  const date = parseIsoDate(value);
  return date !== null && toIso(date) === value;
}

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`Fecha inválida: ${iso}`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/** Los 7 días de la semana que empieza en `startIso`. */
export function weekDays(startIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

/** Lunes de la semana de `iso`. */
export function mondayOf(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`Fecha inválida: ${iso}`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

/**
 * Primer día del período que contiene `iso`, con períodos que empiezan el día ISO `startWeekday`
 * (1 = lunes … 7 = domingo; lo fija la política de distribución).
 */
export function periodStartOf(iso: string, startWeekday: number): string {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`Fecha inválida: ${iso}`);
  if (!Number.isInteger(startWeekday) || startWeekday < 1 || startWeekday > 7) {
    throw new Error(`Día de inicio inválido: ${startWeekday}`);
  }
  const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1;
  return addDays(iso, -((isoWeekday - startWeekday + 7) % 7));
}

/** Fecha de hoy ("2026-09-28") en una zona horaria IANA (la del restaurante), para el servidor. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Fecha de hoy en el calendario local del navegador. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "2024-11-23" → "sábado, 23 de noviembre de 2024". */
export function formatLongDate(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? LONG.format(date) : iso;
}

/** "2024-11-23" → "23/11/2024". */
export function formatShortDate(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? SHORT.format(date) : iso;
}

/** "2024-11-23" → "23/11". */
export function formatDayMonth(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? DAY_MONTH.format(date) : iso;
}

/** "2024-11-23" → "sábado". */
export function formatWeekday(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? WEEKDAY.format(date) : iso;
}

/** "2024-11" → "Noviembre de 2024". */
export function formatMonth(yearMonth: string): string {
  const date = parseIsoDate(`${yearMonth}-01`);
  if (!date) return yearMonth;
  const text = MONTH.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Semana del 18/11 al 24/11/2024". */
export function formatWeekRange(startIso: string): string {
  return `Semana del ${formatDayMonth(startIso)} al ${formatShortDate(addDays(startIso, 6))}`;
}
