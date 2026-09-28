/**
 * Validación (Zod) de lo que llega del navegador a las acciones de sobres. Solo ids y textos: el
 * restaurante, el usuario, el rol, el empleado y los importes nunca vienen del navegador. Que un
 * sobre o un reparto sean de ESTE restaurante lo verifica el servicio contra la base.
 */
import { z } from 'zod';
import { MIN_REASON_LENGTH } from '@/lib/envelopes/view';

const id = z.uuid({ error: 'Ese dato no es válido.' });

const reason = z
  .string({ error: 'Contá el motivo.' })
  .trim()
  .min(MIN_REASON_LENGTH, {
    error: `El motivo es obligatorio (mínimo ${MIN_REASON_LENGTH} caracteres).`,
  })
  .max(300, { error: 'El motivo puede tener hasta 300 caracteres.' });

export const prepareEnvelopesInput = z.object({
  settlementId: id,
  /** Sin lista: todos los pendientes con importe. */
  paymentIds: z.array(id).min(1).max(500).optional(),
});

export const deliverEnvelopeInput = z.object({
  paymentId: id,
  note: z
    .string()
    .trim()
    .max(200, { error: 'La nota puede tener hasta 200 caracteres.' })
    .optional()
    .default(''),
});

export const undoPreparationInput = z.object({ paymentId: id, reason });

export const revertDeliveryInput = z.object({ paymentId: id, reason });

export type PrepareEnvelopesInput = z.infer<typeof prepareEnvelopesInput>;
export type DeliverEnvelopeInput = z.infer<typeof deliverEnvelopeInput>;
export type UndoPreparationInput = z.infer<typeof undoPreparationInput>;
export type RevertDeliveryInput = z.infer<typeof revertDeliveryInput>;
