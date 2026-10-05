/**
 * Validación (Zod) de lo que llega del navegador a las acciones de comentarios. Los mismos largos
 * que la base (`ck_feedback_*`) y que el formulario, con mensajes para el usuario.
 */
import { z } from 'zod';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_LIMITS,
  FEEDBACK_STATUSES,
  safeFeedbackPage,
} from '@/lib/feedback/view';

export const feedbackInput = z.object({
  category: z.enum(FEEDBACK_CATEGORIES, {
    error: 'Elegí el tipo: error, sugerencia o comentario.',
  }),
  title: z
    .string()
    .trim()
    .max(FEEDBACK_LIMITS.titleMax, {
      error: `El título puede tener hasta ${FEEDBACK_LIMITS.titleMax} caracteres.`,
    })
    .optional()
    .transform((value) => (value ? value : null)),
  description: z
    .string({ error: 'Contanos qué pasó o qué te gustaría.' })
    .trim()
    .min(FEEDBACK_LIMITS.descriptionMin, {
      error: `Contanos un poco más (al menos ${FEEDBACK_LIMITS.descriptionMin} caracteres).`,
    })
    .max(FEEDBACK_LIMITS.descriptionMax, {
      error: `La descripción puede tener hasta ${FEEDBACK_LIMITS.descriptionMax} caracteres.`,
    }),
  page: z
    .string()
    .optional()
    .nullable()
    .transform((value) => safeFeedbackPage(value)),
  /** Campo trampa: invisible para las personas; si viene con algo, es un robot. */
  website: z.string().optional(),
});
export type FeedbackInput = z.output<typeof feedbackInput>;

export const feedbackStatusInput = z.object({
  id: z.uuid({ error: 'Ese comentario no existe.' }),
  status: z.enum(FEEDBACK_STATUSES, { error: 'Ese estado no existe.' }),
});

export const feedbackIdInput = z.object({ id: z.uuid({ error: 'Ese comentario no existe.' }) });
