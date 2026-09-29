/**
 * Validación (Zod) de lo que llega del navegador a las acciones de "Personal". Solo datos del
 * cambio: el restaurante, el usuario y el rol nunca vienen del navegador (los resuelve
 * `requireAccess`). Que un id sea de ESTE restaurante lo verifica el servicio contra la base.
 */
import { z } from 'zod';
import { formatScaled, parseDecimal } from '@/lib/decimal';
import { INDIVIDUAL_POINTS_SCALE } from '@/lib/distribution/participation';

export const MAX_STAFF_NAME = 80;

const id = z.uuid({ error: 'Ese dato no es válido.' });

const name = z
  .string({ error: 'Poné el nombre de la persona.' })
  .trim()
  .min(1, { error: 'Poné el nombre de la persona.' })
  .max(MAX_STAFF_NAME, { error: `El nombre puede tener hasta ${MAX_STAFF_NAME} caracteres.` });

export const addStaffInput = z.object({
  name,
  positionId: z.uuid({ error: 'Elegí un puesto.' }),
});

export const setStaffPositionInput = z.object({
  employeeId: id,
  positionId: z.uuid({ error: 'Ese puesto no existe.' }),
});

export const setStaffActiveInput = z.object({
  employeeId: id,
  active: z.boolean({ error: 'Ese dato no es válido.' }),
});

/** Tope del tipo de la base (NUMERIC(6,2)): no es un límite de negocio. */
export const MAX_INDIVIDUAL_POINTS_E2 = 999_999n;

/**
 * Puntos individuales: número mayor que cero con hasta 2 decimales ("1,20", "0.8", "1").
 * Se normaliza al texto que acepta la base ("1.20"). Sin floats: se valida sobre enteros.
 */
const individualPoints = z
  .string({ error: 'Poné los puntos de la persona.' })
  .trim()
  .transform((text, ctx) => {
    const pointsE2 = parseDecimal(text, INDIVIDUAL_POINTS_SCALE);
    if (pointsE2 === null || pointsE2 <= 0n) {
      ctx.addIssue({
        code: 'custom',
        message: 'Los puntos tienen que ser un número mayor que cero (hasta 2 decimales).',
      });
      return z.NEVER;
    }
    if (pointsE2 > MAX_INDIVIDUAL_POINTS_E2) {
      ctx.addIssue({ code: 'custom', message: 'Los puntos pueden ser hasta 9.999,99.' });
      return z.NEVER;
    }
    return formatScaled(pointsE2, INDIVIDUAL_POINTS_SCALE, INDIVIDUAL_POINTS_SCALE)
      .replace(/\./g, '')
      .replace(',', '.');
  });

export const setStaffPointsInput = z.object({
  employeeId: id,
  points: individualPoints,
});

export type AddStaffInput = z.infer<typeof addStaffInput>;
export type SetStaffPointsInput = z.infer<typeof setStaffPointsInput>;
export type SetStaffPositionInput = z.infer<typeof setStaffPositionInput>;
export type SetStaffActiveInput = z.infer<typeof setStaffActiveInput>;

/** Primer mensaje de error de una validación fallida (para mostrar en la pantalla). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Ese dato no es válido.';
}
