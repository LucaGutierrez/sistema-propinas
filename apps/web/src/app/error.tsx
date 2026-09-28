'use client';

import { AlertTriangleIcon, RotateCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Error inesperado al armar una pantalla (p. ej. la base no respondió): reintentar o volver. */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-5" />
        </div>
        <CardTitle>No se pudo cargar esta pantalla</CardTitle>
        <CardDescription>
          Puede ser un problema de conexión. Lo que ya guardaste no se perdió.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center gap-2">
        <Button onClick={reset}>
          <RotateCwIcon />
          Reintentar
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Ir al inicio</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
