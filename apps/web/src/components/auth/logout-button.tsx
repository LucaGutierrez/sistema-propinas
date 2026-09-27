'use client';

import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

/** Cierra la sesión (Better Auth borra la fila de `sessions` y la cookie) y vuelve al login. */
export function LogoutButton({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size={size}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      <LogOutIcon className="size-4" />
      {pending ? 'Cerrando…' : 'Cerrar sesión'}
    </Button>
  );
}
