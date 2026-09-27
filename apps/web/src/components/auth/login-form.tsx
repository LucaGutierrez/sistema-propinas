'use client';

import { LogInIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

const noSubscription = () => () => {};

/** Email y contraseña. El mensaje de error es el mismo exista o no la cuenta. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Hasta que carga el JavaScript el botón queda deshabilitado: un envío nativo del formulario
  // nunca debe salir (y menos por GET, con la contraseña en la URL).
  const ready = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    if (failure) {
      setPending(false);
      setError(
        failure.status === 429
          ? 'Demasiados intentos. Esperá un minuto y probá de nuevo.'
          : 'Email o contraseña incorrectos.',
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Contraseña</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={!ready || pending}>
        <LogInIcon className="size-4" />
        {pending ? 'Ingresando…' : 'Iniciar sesión'}
      </Button>
    </form>
  );
}
