import { UserRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { LogoutButton } from './logout-button';

/** Quién está operando y en qué restaurante (datos de la sesión y la membresía, del servidor). */
export function SessionBar({
  userName,
  email,
  role,
  restaurantName,
}: {
  userName: string;
  email: string;
  role: string;
  restaurantName: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
      <UserRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{userName}</span>{' '}
        <span className="text-muted-foreground">({email})</span> · {role} en{' '}
        <span className="font-medium">{restaurantName}</span>
      </p>
      <Link href="/cuenta" className="text-sm font-medium text-primary hover:underline">
        Mi sesión
      </Link>
      <LogoutButton />
    </div>
  );
}
