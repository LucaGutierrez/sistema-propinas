'use client';

import { MenuIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DATABASE_ACCOUNT_NAV,
  DATABASE_VENUE_NAV,
  FEEDBACK_REVIEW_NAV,
  FEEDBACK_SEND_NAV,
  isActiveRoute,
  type DatabaseNavItem,
} from './database-nav';
import { Logo } from './logo';

/** Quién opera y en qué restaurante: lo resuelve el servidor (sesión + membresía). */
export interface ShellAccount {
  userName: string;
  roleLabel: string;
  restaurantName: string | null;
  /** Revisa los comentarios de testers (GUTIP_FEEDBACK_REVIEWERS). */
  feedbackReviewer?: boolean;
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: DatabaseNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActiveRoute(pathname, item.href);
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

function SidebarContent({
  account,
  pathname,
  onNavigate,
}: {
  account: ShellAccount | null;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/" onClick={onNavigate} aria-label="GUTIP, ir al inicio">
          <Logo />
        </Link>
      </div>

      {account?.restaurantName ? (
        <div className="mx-3 mb-4 rounded-lg bg-sidebar-accent/60 px-3 py-2">
          <p className="truncate text-sm font-medium text-sidebar-foreground">
            {account.restaurantName}
          </p>
          <Link
            href="/cuenta"
            onClick={onNavigate}
            className="text-xs text-sidebar-muted hover:text-sidebar-foreground"
          >
            Cambiar de restaurante
          </Link>
        </div>
      ) : null}

      <nav aria-label="Principal" className="flex-1 space-y-1 px-3">
        {account?.restaurantName
          ? DATABASE_VENUE_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))
          : null}
        {account ? (
          <>
            <p className="px-3 pt-5 pb-1 text-xs font-medium tracking-wide text-sidebar-muted uppercase">
              Cuenta
            </p>
            {DATABASE_ACCOUNT_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
            {account.feedbackReviewer ? (
              <NavLink item={FEEDBACK_REVIEW_NAV} pathname={pathname} onNavigate={onNavigate} />
            ) : null}
          </>
        ) : (
          <NavLink item={FEEDBACK_SEND_NAV} pathname={pathname} onNavigate={onNavigate} />
        )}
      </nav>
    </div>
  );
}

/**
 * Shell del modo base de datos. No usa la demo: menú de pantallas reales y la identidad que manda
 * el servidor. Sin sesión (o sin restaurante) no muestra secciones del local.
 */
export function DatabaseShell({
  account,
  children,
}: {
  account: ShellAccount | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar text-sidebar-foreground lg:block print:hidden">
        <SidebarContent account={account} pathname={pathname} />
      </aside>

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
          <SidebarContent
            account={account}
            pathname={pathname}
            onNavigate={() => setMenuOpen(false)}
          />
        </aside>
      </div>

      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6 print:hidden">
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
          {account ? (
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm leading-tight font-medium">{account.userName}</p>
                <p className="text-xs leading-tight text-muted-foreground">
                  {account.roleLabel}
                  {account.restaurantName ? ` · ${account.restaurantName}` : ''}
                </p>
              </div>
              <Link
                href="/cuenta"
                className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                aria-label="Mi sesión"
              >
                {account.userName.charAt(0).toUpperCase()}
              </Link>
            </div>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
