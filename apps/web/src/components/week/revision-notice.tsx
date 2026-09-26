import { HistoryIcon } from 'lucide-react';
import { formatMoney } from '@/lib/decimal';
import type { Week } from '@/lib/demo-store/model';

const WHEN = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Aviso en una semana cuyo cierre se anuló al menos una vez, con el historial de anulaciones. */
export function RevisionNotice({ week }: { week: Week }) {
  const revisions = week.voidedRevisions ?? [];
  if (revisions.length === 0) return null;
  const last = revisions[revisions.length - 1];

  return (
    <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      <p className="flex items-center gap-2 font-medium">
        <HistoryIcon className="size-4" />
        Revisión {week.revision ?? revisions.length + 1}
        {week.status === 'ABIERTA' ? ' · la semana se reabrió para corregirla' : ''}
      </p>
      {last ? (
        <p className="mt-1">
          El cierre anterior (revisión {last.revision},{' '}
          {formatMoney(BigInt(last.result.totalFinalCents))} en sobres) se anuló el{' '}
          {WHEN.format(new Date(last.voidedAt))} por {last.voidedBy}. Motivo: {last.voidReason}
        </p>
      ) : null}
      {revisions.length > 1 ? (
        <details className="mt-2">
          <summary className="cursor-pointer">
            Ver todas las anulaciones ({revisions.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {revisions.map((revision) => (
              <li key={revision.revision}>
                Revisión {revision.revision}: anulada el {WHEN.format(new Date(revision.voidedAt))}{' '}
                por {revision.voidedBy} — {revision.voidReason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
