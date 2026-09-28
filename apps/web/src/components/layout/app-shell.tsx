'use client';

import { usePathname } from 'next/navigation';
import { DatabaseShell, type ShellAccount } from './database-shell';
import { DemoShell } from './demo-shell';

/** Pantallas de cuenta (login, registro, primer restaurante): sin menú ni datos del local. */
const ACCOUNT_SCREENS = new Set(['/login', '/registro', '/crear-restaurante']);

export type DataMode = 'demo' | 'database';

/**
 * Elige el shell según la fuente de datos que decide el SERVIDOR (GUTIP_DATA_SOURCE). En modo base
 * nunca se monta el shell de la demo: el menú, el selector de locales y la identidad ficticia de la
 * demo no aparecen para un usuario real.
 */
export function AppShell({
  mode,
  account,
  children,
}: {
  mode: DataMode;
  account: ShellAccount | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (ACCOUNT_SCREENS.has(pathname)) return <>{children}</>;
  if (mode === 'database') return <DatabaseShell account={account}>{children}</DatabaseShell>;
  return <DemoShell>{children}</DemoShell>;
}
