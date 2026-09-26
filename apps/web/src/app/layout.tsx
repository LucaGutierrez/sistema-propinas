import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'GUTIP', template: '%s · GUTIP' },
  description: 'Gestión y distribución de propinas para restaurantes.',
};

export const viewport: Viewport = {
  themeColor: '#12352b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
