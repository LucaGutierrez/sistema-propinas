import { ChevronRightIcon, LockIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import type { PeriodListItem } from '@/lib/distribution/period-view';

/** Repartos cerrados, del más nuevo al más viejo (cada uno lleva a su detalle). */
export function PeriodList({
  periods,
  title = 'Repartos cerrados',
}: {
  periods: readonly PeriodListItem[];
  title?: string;
}) {
  const closed = periods.filter((p) => p.status === 'CLOSED');
  if (closed.length === 0) return null;
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle>{title}</CardTitle>
        <CardDescription>Quedan guardados tal como se cerraron.</CardDescription>
      </CardHeader>
      <ul className="divide-y border-t">
        {closed.map((p) => (
          <li key={p.settlementId}>
            <Link
              href={`/reparto/${p.settlementId}`}
              className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block font-medium">
                  Semana del {formatDayMonth(p.weekStart)} al {formatShortDate(p.weekEnd)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatMoney(BigInt(p.totalCents ?? '0'))} repartidos
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="success">
                  <LockIcon />
                  Cerrado
                </Badge>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
