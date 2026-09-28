'use client';

import { UserPlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

const noSubscription = () => () => {};

/** Debe coincidir con MIN_PASSWORD_LENGTH / MAX_PASSWORD_LENGTH del servidor (Better Auth). */
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

/**
 * Registro: crea SOLO la cuenta y después inicia sesión con las mismas credenciales. El servidor
 * responde igual exista o no el email; si el inicio de sesión falla, el mensaje es genérico.
 */
export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Hasta que carga el JavaScript el botón queda deshabilitado (nunca un envío nativo).
  const ready = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (name === '') return setError('Poné tu nombre.');
    if (!email.includes('@')) return setError('Poné un email válido.');
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return setError(
        `La contraseña tiene que tener entre ${MIN_PASSWORD} y ${MAX_PASSWORD} caracteres.`,
      );
    }

    setPending(true);
    setError(null);
    const signUp = await authClient.signUp.email({ name, email, password });
    if (signUp.error) {
      setPending(false);
      setError(
        signUp.error.status === 429
          ? 'Demasiados intentos. Esperá un rato y probá de nuevo.'
          : signUp.error.status === 400 && signUp.error.message
            ? signUp.error.message
            : 'No se pudo crear la cuenta. Revisá los datos y probá de nuevo.',
      );
      return;
    }
    const signIn = await authClient.signIn.email({ email, password });
    if (signIn.error) {
      setPending(false);
      setError(
        signIn.error.status === 429
          ? 'Demasiados intentos. Esperá un minuto y probá de nuevo.'
          : 'No pudimos iniciar sesión con esos datos. Si ya tenías una cuenta, iniciá sesión.',
      );
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="registro-nombre">Nombre</Label>
        <Input id="registro-nombre" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="registro-email">Email</Label>
        <Input id="registro-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="registro-password">Contraseña</Label>
        <Input
          id="registro-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        <p className="text-xs text-muted-foreground">Mínimo {MIN_PASSWORD} caracteres.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={!ready || pending}>
        <UserPlusIcon className="size-4" />
        {pending ? 'Creando la cuenta…' : 'Crear cuenta'}
      </Button>
    </form>
  );
}
