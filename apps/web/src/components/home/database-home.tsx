import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleIcon,
  HandCoinsIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { PeriodList } from '@/components/reparto/period-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import type { PeriodOverview } from '@/server/periods/repository';
import type { RestaurantSummary } from '@/server/restaurants/summary';

/**
 * Inicio con los datos de la base. Lo primero es la acción principal (repartir las propinas de la
 * semana); para una cuenta nueva, además, los pasos para llegar al primer reparto.
 */
export function DatabaseHome({
  summary,
  overview,
  role,
  canEdit,
}: {
  summary: RestaurantSummary;
  overview: PeriodOverview;
  role: string;
  canEdit: boolean;
}) {
  const open = overview.open;
  const hasClosed = overview.recent.length > 0;
  const hasStaff = summary.activeEmployees > 0;
  const firstTime = !hasClosed;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{summary.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {role} · {summary.activeEmployees}{' '}
          {summary.activeEmployees === 1 ? 'persona activa' : 'personas activas'}
        </p>
      </div>

      {/* Acción principal */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <HandCoinsIcon className="size-5 text-primary" />
            <CardTitle>{open ? 'Reparto en curso' : 'Repartir propinas'}</CardTitle>
            {open ? <Badge variant="warning">Borrador</Badge> : null}
          </div>
          <CardDescription>
            {open ? (
              <>
                Semana del {formatDayMonth(open.weekStart)} al {formatShortDate(open.weekEnd)} ·
                propina cargada {formatMoney(BigInt(open.tipsCents))} · horas de{' '}
                {open.peopleWithHours} de {open.activePeople}{' '}
                {open.activePeople === 1 ? 'persona' : 'personas'}.
              </>
            ) : (
              'Registrá las propinas y las horas trabajadas para calcular cuánto corresponde a cada persona.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg">
            <Link href="/reparto">
              {open ? 'Seguir con el reparto' : canEdit ? 'Empezar reparto' : 'Ver repartos'}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {firstTime ? (
        <Card>
          <CardHeader>
            <CardTitle>Tu primer reparto en 3 pasos</CardTitle>
            <CardDescription>
              Tu restaurante ya tiene la configuración estándar de GUTIP: no hace falta tocarla.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              <Step
                done={hasStaff}
                title="Cargá a tu equipo"
                href="/personal"
                action="Ir a Personal"
              >
                Cada persona con su puesto (mozo, barra, cocina…).
              </Step>
              <Step
                done={Boolean(open)}
                title="Empezá el reparto de la semana"
                href="/reparto"
                action="Empezar"
              >
                Cargá cuánta propina se juntó y las horas de cada uno.
              </Step>
              <Step done={hasClosed} title="Revisá y cerrá" href="/reparto" action="Ir al reparto">
                GUTIP calcula cuánto le toca a cada persona; al cerrar queda guardado.
              </Step>
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <PeriodList periods={overview.recent} title="Últimos repartos" />

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/personal">
            <UsersIcon />
            Personal
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/configuracion">
            <SlidersHorizontalIcon />
            Configuración de distribución
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Step({
  done,
  title,
  href,
  action,
  children,
}: {
  done: boolean;
  title: string;
  href: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      {done ? (
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary" />
      ) : (
        <CircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className={done ? 'font-medium text-muted-foreground line-through' : 'font-medium'}>
          {title}
        </p>
        <p className="text-muted-foreground">{children}</p>
      </div>
      {done ? null : (
        <Link href={href} className="shrink-0 text-primary hover:underline">
          {action}
        </Link>
      )}
    </li>
  );
}
