import { ClockIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Pantalla que todavía no pasó a la base de datos. En modo base se muestra esto en lugar de la
 * demo: un usuario real nunca ve datos ficticios.
 */
export function NotAvailableYet({ title }: { title: string }) {
  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ClockIcon className="size-5" />
        </div>
        <CardTitle>{title}: todavía no disponible</CardTitle>
        <CardDescription>
          Esta sección se está pasando a tu cuenta real. Por ahora podés usar Personal y
          Configuración de distribución.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/">Ir al inicio</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
