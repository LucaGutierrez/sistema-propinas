'use client';

import { MenuIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ViewAsBanner } from '@/components/access/view-as-banner';
import { ROLE_LABEL } from '@/lib/demo-store/permissions';
import { useDemoStore } from '@/lib/demo-store/store';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { accountNav, isActive, venueNav, type NavItem } from './nav';
import { VenueSwitcher } from './venue-switcher';

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-white'
          : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <item.icon className={cn('size-4', active ? 'text-sidebar-primary' : 'text-sidebar-muted')} />
      {item.label}
    </Link>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { perms, viewAs } = useDemoStore();
  const account = accountNav(viewAs === null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/" onClick={onNavigate} aria-label="GUTIP, ir al inicio">
          <Logo />
        </Link>
      </div>

      <VenueSwitcher onNavigate={onNavigate} />

      <nav aria-label="Principal" className="flex-1 space-y-1 px-3">
        {venueNav(perms).map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
        {account.length > 0 ? (
          <>
            <p className="px-3 pt-5 pb-1 text-xs font-medium tracking-wide text-sidebar-muted uppercase">
              Cuenta
            </p>
            {account.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </>
        ) : null}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-muted">
        Fase 1 · versión preliminar
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { workspace, venue, viewAs } = useDemoStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = viewAs
    ? { name: viewAs.name, role: ROLE_LABEL[viewAs.role] }
    : { name: 'Encargado', role: 'Dueño de la cuenta' };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // El login va sin menú ni datos del local.
  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="min-h-dvh">
      {/* Sidebar fija en escritorio */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar text-sidebar-foreground lg:block print:hidden">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Menú deslizable en celular */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden print:hidden',
          menuOpen ? 'visible' : 'invisible',
        )}
        aria-hidden={!menuOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/50 transition-opacity',
            menuOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMenuOpen(false)}
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground shadow-xl transition-transform',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="absolute top-4 right-3 rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-accent"
            aria-label="Cerrar menú"
          >
            <XIcon className="size-5" />
          </button>
          <SidebarContent pathname={pathname} onNavigate={() => setMenuOpen(false)} />
        </aside>
      </div>

      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <MenuIcon className="size-5" />
          </Button>
          <span className="text-base font-bold tracking-tight lg:hidden">
            GU<span className="text-primary">TIP</span>
          </span>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="warning" className="hidden sm:inline-flex">
              Modo demo
            </Badge>
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium">{identity.name}</p>
              <p className="text-xs leading-tight text-muted-foreground">
                {identity.role} · {venue?.name ?? ''}
              </p>
            </div>
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-sm font-semibold',
                viewAs ? 'bg-sky-600 text-white' : 'bg-primary text-primary-foreground',
              )}
              aria-hidden="true"
            >
              {identity.name.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        <ViewAsBanner />
        {/* Al cambiar de local se reinicia el estado de la pantalla (cálculos, formularios). */}
        <main
          key={workspace?.activeVenueId ?? 'cargando'}
          className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
