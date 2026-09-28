'use client';

import { StoreIcon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { createRestaurantAction } from '@/app/crear-restaurante/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Nombre del restaurante. Al crearlo, el servidor redirige al inicio. */
export function CreateRestaurantForm() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const failure = await createRestaurantAction(name);
      if (failure) setError(failure);
    });
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="restaurante-nombre">Nombre del restaurante</Label>
        <Input
          id="restaurante-nombre"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="Ej.: Bar del Puerto"
          autoComplete="off"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        <StoreIcon className="size-4" />
        {pending ? 'Creando…' : 'Crear restaurante'}
      </Button>
    </form>
  );
}
