'use client';

import { EyeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROLE_LABEL } from '@/lib/demo-store/permissions';
import { useDemoStore } from '@/lib/demo-store/store';
import { setViewAs } from '@/lib/demo-store/workspace';

/** Aviso fijo mientras se simula la vista de otra persona. */
export function ViewAsBanner() {
  const { viewAs, venue, applyWorkspace } = useDemoStore();
  if (!viewAs || !venue) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-sky-200 bg-sky-50 print:hidden px-4 py-2.5 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="flex items-center gap-2">
        <EyeIcon className="size-4 shrink-0" />
        <span>
          Estás viendo {venue.name} como <strong>{viewAs.name}</strong> ({ROLE_LABEL[viewAs.role]}).
          Así lo va a ver cuando acepte la invitación.
        </span>
      </p>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-sky-300 bg-white"
        onClick={() => applyWorkspace((ws) => setViewAs(ws, null))}
      >
        Volver a mi vista
      </Button>
    </div>
  );
}
