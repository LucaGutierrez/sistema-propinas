/**
 * Validación (Zod) del alta de restaurante. Del navegador llega SOLO el nombre: quién lo crea sale
 * de la sesión y el rol (OWNER) lo asigna el servidor.
 */
import { z } from 'zod';
import { MAX_RESTAURANT_NAME } from './service';

export const createRestaurantInput = z.object({
  name: z
    .string({ error: 'Poné un nombre para el restaurante.' })
    .trim()
    .min(1, { error: 'Poné un nombre para el restaurante.' })
    .max(MAX_RESTAURANT_NAME, {
      error: `El nombre puede tener hasta ${MAX_RESTAURANT_NAME} caracteres.`,
    }),
});
