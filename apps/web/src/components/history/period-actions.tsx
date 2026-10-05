'use client';

import { LoaderCircleIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { redoPeriodAction, voidPeriodAction } from '@/app/reparto/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HistoryDetail } from '@/lib/history/view';

const MIN_REASON = 10;

/**
 * "Eliminar" un reparto cerrado = anularlo (confirmación y motivo obligatorio): sale del historial
 * por defecto pero se conserva para la auditoría (DATABASE.md §6). Y rehacer uno anulado. Los botones
 * dependen del rol, pero el servidor vuelve a verificar todo al actuar.
 */
export function PeriodActions({ detail }: { detail: HistoryDetail }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (detail.status === 'CLOSED' && !detail.canVoid) return null;
  if (detail.status === 'VOIDED' && !detail.canRedo && !detail.supersededBy) return null;

  async function voidIt() {
    setBusy(true);
    setError(null);
    const result = await voidPeriodAction(detail.settlementId, reason).catch(() => ({
      ok: false as const,
      error: 'No se pudo eliminar. Revisá tu conexión y probá de nuevo.',
    }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    setReason('');
    router.refresh();
  }

  async function redo() {
    setBusy(true);
    setError(null);
    const result = await redoPeriodAction(detail.settlementId).catch(() => ({
      ok: false as const,
      error: 'No se pudo rehacer. Revisá tu conexión y probá de nuevo.',
    }));
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.push('/reparto');
  }

  if (detail.status === 'VOIDED') {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        {detail.supersededBy ? (
          <p>
            Este reparto se rehízo.{' '}
            <Link
              href={
                detail.supersededBy.status === 'OPEN'
                  ? '/reparto'
                  : `/historial/${detail.supersededBy.settlementId}`
              }
              className="font-medium text-primary hover:underline"
            >
              {detail.supersededBy.status === 'OPEN'
                ? 'Ver el reparto nuevo (en curso)'
                : 'Ver el reparto nuevo'}
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">
              Para corregirlo, rehacé el reparto: se abre uno nuevo para la misma semana, con la
              misma configuración, y cargás propina y horas de nuevo.
            </p>
            <Button onClick={() => void redo()} disabled={busy}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />}
              Rehacer reparto
            </Button>
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const blocked = detail.deliveredEnvelopes > 0;
  return (
    <div className="rounded-xl border bg-card p-4 text-sm">
      {confirming ? (
        <div className="space-y-3">
          <p className="font-medium">¿Seguro que querés eliminar este reparto?</p>
          <p className="text-muted-foreground">
            Deja de aparecer en el historial y sus sobres no se entregan. Para no perder la
            auditoría, queda guardado como anulado (lo ves con el filtro &quot;Eliminados&quot;) y
            los adelantos descontados vuelven a quedar pendientes. Después podés rehacer la semana
            con los datos correctos.
          </p>
          <Input
            aria-label="Motivo de la eliminación"
            placeholder={`Por qué lo eliminás (mínimo ${MIN_REASON} caracteres)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
                setReason('');
                setError(null);
              }}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void voidIt()}
              disabled={busy || reason.trim().length < MIN_REASON}
            >
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
              Sí, eliminar reparto
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            {blocked
              ? `No se puede anular: ${
                  detail.deliveredEnvelopes === 1
                    ? 'hay 1 sobre entregado'
                    : `hay ${detail.deliveredEnvelopes} sobres entregados`
                }. Primero revertí esas entregas en Sobres.`
              : '¿Se cargó mal este reparto? Eliminalo y rehacé la semana.'}
          </p>
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={blocked}>
            <Trash2Icon />
            Eliminar reparto
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
