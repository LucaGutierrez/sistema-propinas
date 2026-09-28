import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import type { ShellAccount } from '@/components/layout/database-shell';
import { AccessDenied, resolveAccess } from '@/server/access/access';
import { activeRestaurantId } from '@/server/access/request';
import { ROLE_LABEL, ROLES } from '@/server/access/roles';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
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

/** Identidad del encabezado en modo base: usuario de la sesión y su rol en el restaurante activo. */
async function shellAccount(): Promise<ShellAccount | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const restaurantId = await activeRestaurantId(user);
  if (!restaurantId)
    return { userName: user.name, roleLabel: 'Sin restaurante', restaurantName: null };
  try {
    const access = await resolveAccess(getDb(), user, { restaurantId, roles: ROLES });
    return {
      userName: user.name,
      roleLabel: ROLE_LABEL[access.role],
      restaurantName: access.restaurantName,
    };
  } catch (error) {
    if (error instanceof AccessDenied) {
      return { userName: user.name, roleLabel: 'Sin restaurante', restaurantName: null };
    }
    throw error;
  }
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
