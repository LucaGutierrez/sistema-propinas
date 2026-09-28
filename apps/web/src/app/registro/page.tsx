import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { RegisterForm } from '@/components/auth/register-form';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';

export const metadata: Metadata = { title: 'Crear cuenta' };
export const dynamic = 'force-dynamic';

/** Registro público: crea solo la cuenta; el restaurante se crea en el paso siguiente. */
export default async function RegisterPage() {
  if (!databaseEnabled()) {
    return (
      <AuthLayout>
        <CardHeader>
          <CardTitle>Modo demo</CardTitle>
          <CardDescription>
            Este servidor usa la demo del navegador: no hay cuentas ni registro.
          </CardDescription>
        </CardHeader>
      </AuthLayout>
    );
  }
  // Ya tiene sesión: al inicio (que lo manda a crear su restaurante si no tiene ninguno).
  if (await getSessionUser()) redirect('/');

  return (
    <AuthLayout
      footer={
        <>
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Iniciá sesión
          </Link>
        </>
      }
    >
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>
          Registrate y después creá tu restaurante. Vas a quedar como su Dueño.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
    </AuthLayout>
  );
}
