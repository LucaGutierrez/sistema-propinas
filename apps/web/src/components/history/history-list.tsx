import {
  ChevronDownIcon,
  ChevronRightIcon,
  FilterIcon,
  HistoryIcon,
  LockIcon,
  SearchIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { nativeSelectClass } from '@/components/ui/native-select';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import { historyHref } from '@/lib/history/filters';
import type { HistoryFilters, HistoryList } from '@/lib/history/view';

const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});

function StatusBadge({ status }: { status: string }) {
  return status === 'VOIDED' ? (
    <Badge variant="outline">Eliminado</Badge>
  ) : (
    <Badge variant="success">
      <LockIcon />
      Cerrado
    </Badge>
  );
}

/** Historial de repartos (solo lectura): filtros por URL, lista y paginación. */
export function HistoryListView({ list, filters }: { list: HistoryList; filters: HistoryFilters }) {
  const filtered = Boolean(
    filters.status !== 'CLOSED' || filters.from || filters.to || filters.employee,
  );
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Historial</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {list.ownOnly
            ? 'Tus repartos cerrados: cuánto te correspondió y si ya te entregaron el sobre.'
            : 'Los repartos guardados, tal como quedaron. Para eliminar uno que se cargó mal, abrilo y usá "Eliminar reparto".'}
        </p>
      </div>

      {/* En el celular los filtros se pliegan para que la lista quede a la vista. */}
      <details className="group mb-4 rounded-xl border bg-card" open={filtered || undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <FilterIcon className="size-4 text-muted-foreground" />
            Filtros
            {filtered ? (
              <Badge variant="secondary" className="font-normal">
                Activos
              </Badge>
            ) : null}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <form
          method="get"
          action="/historial"
          className="grid grid-cols-2 gap-3 border-t p-4 lg:grid-cols-4"
        >
          <div className="col-span-2 lg:col-span-1">
            <label htmlFor="estado" className="mb-1 block text-xs text-muted-foreground">
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={filters.status === 'CLOSED' ? '' : (filters.status ?? 'TODOS')}
              className={nativeSelectClass}
            >
              <option value="">Guardados</option>
              <option value="VOIDED">Eliminados</option>
              <option value="TODOS">Todos</option>
            </select>
          </div>
          <div>
            <label htmlFor="desde" className="mb-1 block text-xs text-muted-foreground">
              Semanas desde
            </label>
            <Input id="desde" name="desde" type="date" defaultValue={filters.from ?? ''} />
          </div>
          <div>
            <label htmlFor="hasta" className="mb-1 block text-xs text-muted-foreground">
              Semanas hasta
            </label>
            <Input id="hasta" name="hasta" type="date" defaultValue={filters.to ?? ''} />
          </div>
          {list.ownOnly ? null : (
            <div className="col-span-2 lg:col-span-1">
              <label htmlFor="persona" className="mb-1 block text-xs text-muted-foreground">
                Persona
              </label>
              <Input
                id="persona"
                name="persona"
                placeholder="Nombre"
                defaultValue={filters.employee ?? ''}
              />
            </div>
          )}
          <div className="col-span-2 grid grid-cols-2 gap-2 sm:flex lg:col-span-4">
            <Button type="submit" size="sm" className={filtered ? '' : 'col-span-2'}>
              <SearchIcon />
              Filtrar
            </Button>
            {filtered ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/historial">Limpiar</Link>
              </Button>
            ) : null}
          </div>
        </form>
      </details>

      {list.items.length === 0 ? (
        <Card className="text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <HistoryIcon className="size-5" />
            </div>
            <CardTitle>{filtered ? 'Sin resultados' : 'Todavía no hay historial'}</CardTitle>
            <CardDescription>
              {filtered
                ? 'Ningún reparto coincide con esos filtros.'
                : 'Cuando cierres un reparto, va a aparecer acá.'}
            </CardDescription>
          </CardHeader>
          {filtered || list.ownOnly ? null : (
            <div className="pb-6">
              <Button asChild>
                <Link href="/reparto">Ir a Repartir propinas</Link>
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {list.items.map((item) => (
              <li key={item.settlementId}>
                <Link
                  href={`/historial/${item.settlementId}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 sm:px-6"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      Semana del {formatDayMonth(item.weekStart)} al {formatShortDate(item.weekEnd)}
                    </span>
                    <span className="my-1 block sm:hidden">
                      <StatusBadge status={item.status} />
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {formatMoney(BigInt(item.totalCents))}
                      {list.ownOnly ? ' te correspondieron' : ''}
                      {item.participants !== null
                        ? ` · ${item.participants} ${item.participants === 1 ? 'persona' : 'personas'}`
                        : ''}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.status === 'VOIDED'
                        ? `Eliminado (anulado)${item.voidedAt ? ` el ${dateTime.format(new Date(item.voidedAt))}` : ''}`
                        : `${item.delivered} de ${item.envelopes} sobres entregados${
                            BigInt(item.toDeliverCents) > 0n
                              ? ` · falta entregar ${formatMoney(BigInt(item.toDeliverCents))}`
                              : ''
                          }`}
                      {item.closedAt
                        ? ` · cerrado el ${dateTime.format(new Date(item.closedAt))}${
                            item.closedBy ? ` por ${item.closedBy}` : ''
                          }`
                        : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hidden sm:inline-flex">
                      <StatusBadge status={item.status} />
                    </span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {filters.page > 1 || list.hasMore ? (
        <div className="mt-4 flex justify-between gap-2">
          {filters.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={historyHref(filters, filters.page - 1)}>Más recientes</Link>
            </Button>
          ) : (
            <span />
          )}
          {list.hasMore ? (
            <Button asChild variant="outline" size="sm">
              <Link href={historyHref(filters, filters.page + 1)}>Más antiguos</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
