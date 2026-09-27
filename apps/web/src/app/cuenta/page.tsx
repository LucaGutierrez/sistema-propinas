import { CheckIcon, StoreIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/auth/logout-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listUserRestaurants } from '@/server/access/access';
import { activeRestaurantId } from '@/server/access/request';
import { ROLE_LABEL } from '@/server/access/roles';
import { getSessionUser } from '@/server/auth/session';
import { databaseEnabled } from '@/server/context';
import { getDb } from '@/server/db';
import { selectRestaurantAction } from './actions';

export const metadata: Metadata = { title: 'Mi sesión' };
export const dynamic = 'force-dynamic';

/** Estado de la sesión: quién soy, en qué restaurantes y con qué rol, cuál está activo. */
export default async function AccountPage() {
  if (!databaseEnabled()) redirect('/');
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Fcuenta');

  const [restaurants, active] = await Promise.all([
    listUserRestaurants(getDb(), user.id),
    activeRestaurantId(user),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mi sesión</CardTitle>
          <CardDescription>
            {user.name} · {user.email}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoutButton size="default" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mis restaurantes</CardTitle>
          <CardDescription>
            Tu rol en cada uno define qué podés ver y hacer. El activo es el que usan las pantallas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {restaurants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no tenés acceso a ningún restaurante.
            </p>
          ) : (
            <ul className="divide-y">
              {restaurants.map((r) => (
                <li key={r.restaurantId} className="flex items-center gap-3 py-3">
                  <StoreIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1 font-medium">{r.name}</span>
                  <Badge variant="secondary">{ROLE_LABEL[r.role]}</Badge>
                  {r.restaurantId === active ? (
                    <span className="flex items-center gap-1 text-sm text-primary">
                      <CheckIcon className="size-4" /> Activo
                    </span>
                  ) : (
                    <form action={selectRestaurantAction}>
                      <input type="hidden" name="restaurantId" value={r.restaurantId} />
                      <Button type="submit" variant="outline" size="sm">
                        Usar este
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-sm">
        <Link href="/configuracion" className="font-medium text-primary hover:underline">
          Ir a Configuración de distribución
        </Link>
      </p>
    </div>
  );
}
