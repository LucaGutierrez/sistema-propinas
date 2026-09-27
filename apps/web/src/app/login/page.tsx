import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { Logo } from '@/components/layout/logo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNextPath } from '@/lib/safe-next';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';

export const metadata: Metadata = { title: 'Iniciar sesión' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const raw = (await searchParams).next;
  // Sin destino, a "Mi sesión": el inicio todavía es la demo y no muestra la sesión.
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw, '/cuenta');

  if (!databaseEnabled()) {
    return (
      <Centered>
        <CardHeader>
          <CardTitle>Modo demo</CardTitle>
          <CardDescription>
            Este servidor usa la demo del navegador: no hay cuentas ni inicio de sesión.
          </CardDescription>
        </CardHeader>
      </Centered>
    );
  }
  if (await getSessionUser()) redirect(next);

  return (
    <Centered>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Entrá con el email y la contraseña de tu cuenta de GUTIP.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} />
      </CardContent>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4">
      <Logo />
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  );
}
