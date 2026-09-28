/**
 * Validación (Zod) de lo que llega del navegador a las acciones del reparto. Solo datos del
 * cambio: el restaurante, el usuario y el rol nunca vienen del navegador (los resuelve
 * `requireAccess`). Que un período, una persona o un adelanto sean de ESTE restaurante lo verifica
 * el servicio contra la base.
 */
import { z } from 'zod';
import { isIsoDate } from '@/lib/dates';
import { parseMoney } from '@/lib/decimal';
import { parseHours, MAX_PERIOD_HOURS } from '@/lib/distribution/period-preview';

/** Tope de un importe (propina de un día o del período, adelanto): $ 10.000.000.000,00. */
export const MAX_AMOUNT_CENTS = 1_000_000_000_000n;
/** Tope de filas por pedido al cargar horas (pegar una columna de una planilla). */
export const MAX_HOURS_ROWS = 500;

const id = z.uuid({ error: 'Ese dato no es válido.' });
const isoDate = z.string().refine(isIsoDate, { error: 'Esa fecha no es válida.' });

/** Importe escrito como en Argentina ("347.990", "1.234,50", "") → centavos. Vacío = 0. */
const money = (label: string) =>
  z
    .string({ error: `${label}: ingresá un importe.` })
    .max(40, { error: `${label}: el importe no es válido.` })
    .transform((text, ctx) => {
      if (text.trim() === '') return 0n;
      const cents = parseMoney(text);
      if (cents === null || cents > MAX_AMOUNT_CENTS) {
        ctx.addIssue({ code: 'custom', message: `${label}: el importe no es válido.` });
        return z.NEVER;
      }
      return cents;
    });

export const startPeriodInput = z.object({
  /** Cualquier día del período a empezar (se ajusta al día de inicio de la política). */
  date: isoDate.optional(),
});

export const setTipsInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('total'), settlementId: id, total: money('Propina') }),
  z.object({
    mode: z.literal('daily'),
    settlementId: id,
    days: z
      .array(z.object({ date: isoDate, amount: money('Propina del día') }))
      .max(7, { error: 'Un período tiene 7 días.' }),
  }),
]);

const hours = z
  .string()
  .max(12)
  .nullable()
  .refine((value) => value === null || value.trim() === '' || parseHours(value) !== null, {
    error: `Las horas tienen que ser un número entre 0 y ${MAX_PERIOD_HOURS} (hasta 2 decimales).`,
  })
  .transform((value) => (value === null || value.trim() === '' ? null : value.trim()));

export const setHoursInput = z.object({
  settlementId: id,
  entries: z
    .array(z.object({ employeeId: id, hours }))
    .min(1, { error: 'No hay horas para guardar.' })
    .max(MAX_HOURS_ROWS, { error: 'Son demasiadas filas de una vez.' }),
});

export const addAdvanceInput = z.object({
  settlementId: id,
  employeeId: z.uuid({ error: 'Elegí a la persona.' }),
  date: isoDate,
  amount: money('Adelanto'),
  note: z.string().trim().max(200, { error: 'La nota puede tener hasta 200 caracteres.' }),
});

export const voidAdvanceInput = z.object({
  advanceId: id,
  reason: z
    .string()
    .trim()
    .min(10, { error: 'Contá el motivo (al menos 10 caracteres).' })
    .max(300, { error: 'El motivo puede tener hasta 300 caracteres.' }),
});

export const closePeriodInput = z.object({ settlementId: id });

export type StartPeriodInput = z.infer<typeof startPeriodInput>;
export type SetTipsInput = z.infer<typeof setTipsInput>;
export type SetHoursInput = z.infer<typeof setHoursInput>;
export type AddAdvanceInput = z.infer<typeof addAdvanceInput>;
export type VoidAdvanceInput = z.infer<typeof voidAdvanceInput>;
export type ClosePeriodInput = z.infer<typeof closePeriodInput>;
