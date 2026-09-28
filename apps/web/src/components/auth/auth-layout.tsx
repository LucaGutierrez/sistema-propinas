import { Logo } from '@/components/layout/logo';
import { Card } from '@/components/ui/card';

/** Marco de las pantallas de cuenta (login, registro, primer restaurante): logo y una tarjeta. */
export function AuthLayout({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4">
      <Logo />
      <Card className="w-full max-w-sm">{children}</Card>
      {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
