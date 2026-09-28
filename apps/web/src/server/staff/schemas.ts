/**
 * Validación (Zod) de lo que llega del navegador a las acciones de "Personal". Solo datos del
 * cambio: el restaurante, el usuario y el rol nunca vienen del navegador (los resuelve
 * `requireAccess`). Que un id sea de ESTE restaurante lo verifica el servicio contra la base.
 */
import { z } from 'zod';

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

export type AddStaffInput = z.infer<typeof addStaffInput>;
export type SetStaffPositionInput = z.infer<typeof setStaffPositionInput>;
export type SetStaffActiveInput = z.infer<typeof setStaffActiveInput>;

/** Primer mensaje de error de una validación fallida (para mostrar en la pantalla). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Ese dato no es válido.';
}
