import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { CreateRestaurantForm } from '@/components/onboarding/create-restaurant-form';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listUserRestaurants } from '@/server/access/access';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';

export const metadata: Metadata = { title: 'Crear restaurante' };
export const dynamic = 'force-dynamic';

/**
 * Primer paso después del registro (o para sumar otro restaurante). El restaurante nace vacío,
 * con la configuración estándar de GUTIP, y quien lo crea queda como Dueño.
 */
export default async function CreateRestaurantPage() {
  if (!databaseEnabled()) redirect('/');
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/crear-restaurante')}`);
  const mine = await listUserRestaurants(getDb(), user.id);

  return (
    <AuthLayout
      footer={
        mine.length > 0 ? (
          <>
            Ya tenés {mine.length} {mine.length === 1 ? 'restaurante' : 'restaurantes'}.{' '}
            <Link href="/cuenta" className="font-medium text-primary hover:underline">
              Elegir uno en Mi sesión
            </Link>
          </>
        ) : (
          <>Sesión iniciada como {user.email}</>
        )
      }
    >
      <CardHeader>
        <CardTitle>
          {mine.length === 0 ? 'Creá tu restaurante' : 'Crear otro restaurante'}
        </CardTitle>
        <CardDescription>
          Empieza vacío, con la configuración estándar de distribución de GUTIP (la podés cambiar
          después en Configuración). Vas a quedar como Dueño.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateRestaurantForm />
      </CardContent>
    </AuthLayout>
  );
}
