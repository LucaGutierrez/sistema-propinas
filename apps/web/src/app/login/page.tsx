import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm } from '@/components/auth/login-form';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  // Sin destino, al inicio (que manda a crear el primer restaurante si todavía no hay ninguno).
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw, '/');

  if (!databaseEnabled()) {
    return (
      <AuthLayout>
        <CardHeader>
          <CardTitle>Modo demo</CardTitle>
          <CardDescription>
            Este servidor usa la demo del navegador: no hay cuentas ni inicio de sesión.
          </CardDescription>
        </CardHeader>
      </AuthLayout>
    );
  }
  if (await getSessionUser()) redirect(next);

  return (
    <AuthLayout
      footer={
        <>
          ¿No tenés cuenta?{' '}
          <Link href="/registro" className="font-medium text-primary hover:underline">
            Creá una
          </Link>
          <span className="mt-2 block">
            ¿Estás probando GUTIP?{' '}
            <Link href="/feedback" className="font-medium text-primary hover:underline">
              Dejanos un comentario
            </Link>{' '}
            (sin cuenta).
          </span>
        </>
      }
    >
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Entrá con el email y la contraseña de tu cuenta de GUTIP.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} />
      </CardContent>
    </AuthLayout>
  );
}
