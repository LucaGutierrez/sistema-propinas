import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import type { ShellAccount } from '@/components/layout/database-shell';
import { getActiveAccess } from '@/server/access/request';
import { ROLE_LABEL } from '@/server/access/roles';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'GUTIP', template: '%s · GUTIP' },
  description: 'Gestión y distribución de propinas para restaurantes.',
};

export const viewport: Viewport = {
  themeColor: '#12352b',
};

// La fuente de datos (demo o base) se decide en el servidor en cada pedido: una página nunca queda
// prerenderizada con la demo en un servidor que usa la base.
export const dynamic = 'force-dynamic';

/**
 * Identidad del encabezado en modo base: usuario de la sesión y su rol en el restaurante activo.
 * Usa el MISMO acceso memoizado del pedido que la página (`getActiveAccess`): sin consultas extra.
 */
async function shellAccount(): Promise<ShellAccount | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const active = await getActiveAccess();
  if (!active.ok)
    return { userName: user.name, roleLabel: 'Sin restaurante', restaurantName: null };
  return {
    userName: user.name,
    roleLabel: ROLE_LABEL[active.access.role],
    restaurantName: active.access.restaurantName,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = databaseEnabled() ? 'database' : 'demo';
  const account = mode === 'database' ? await shellAccount() : null;
  return (
    <html lang="es">
      <body>
        <AppShell mode={mode} account={account}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
