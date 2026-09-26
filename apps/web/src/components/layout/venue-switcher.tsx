'use client';

import { CheckIcon, ChevronsUpDownIcon, SettingsIcon, StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useDemoStore } from '@/lib/demo-store/store';
import { setActiveVenue } from '@/lib/demo-store/workspace';
import { cn } from '@/lib/utils';

/** Selector del local activo, en la barra lateral. */
export function VenueSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace, venue, viewAs, applyWorkspace } = useDemoStore();
  // Quien fue invitado entra solo a su local: mientras se simula, no se cambia de local.
  const locked = viewAs !== null;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(venueId: string) {
    applyWorkspace((ws) => setActiveVenue(ws, venueId));
    setOpen(false);
    onNavigate?.();
    // El detalle de una semana es de un local: al cambiar, se vuelve al historial.
    if (pathname.startsWith('/semanas/')) router.push('/historial');
  }

  return (
    <div ref={rootRef} className="relative mx-3 mb-4">
      <button
        type="button"
        onClick={() => !locked && setOpen((value) => !value)}
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent/60 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent disabled:cursor-default disabled:hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:outline-none"
      >
        <StoreIcon className="size-4 shrink-0 text-sidebar-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{venue?.name ?? 'Cargando…'}</span>
          <span className="block text-xs text-sidebar-muted">
            {locked
              ? 'Solo este local'
              : workspace
                ? `${workspace.venues.length} ${workspace.venues.length === 1 ? 'local' : 'locales'}`
                : ' '}
          </span>
        </span>
        {locked ? null : <ChevronsUpDownIcon className="size-4 shrink-0 text-sidebar-muted" />}
      </button>

      {open && workspace ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar shadow-xl">
          <p className="px-3 pt-2.5 pb-1 text-xs font-medium tracking-wide text-sidebar-muted uppercase">
            Locales
          </p>
          <ul role="listbox" aria-label="Locales" className="max-h-64 overflow-y-auto py-1">
            {workspace.venues.map((item) => {
              const selected = item.id === workspace.activeVenueId;
              return (
                <li key={item.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => choose(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent',
                      selected && 'text-white',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {selected ? <CheckIcon className="size-4 text-sidebar-primary" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <Link
            href="/locales"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2.5 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <SettingsIcon className="size-4" />
            Administrar locales
          </Link>
        </div>
      ) : null}
    </div>
  );
}
