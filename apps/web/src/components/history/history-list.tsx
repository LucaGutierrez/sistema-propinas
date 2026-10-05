import { ChevronRightIcon, HistoryIcon, LockIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDayMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/decimal';
import { historyHref } from '@/lib/history/filters';
import type { HistoryFilters, HistoryList } from '@/lib/history/view';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 md:text-sm';

const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});

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

      <form
        method="get"
        action="/historial"
        className="mb-4 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label htmlFor="estado" className="mb-1 block text-xs text-muted-foreground">
            Estado
          </label>
          <select
            id="estado"
            name="estado"
            defaultValue={filters.status === 'CLOSED' ? '' : (filters.status ?? 'TODOS')}
            className={SELECT_CLASS}
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
          <div>
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
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" size="sm">
            <SearchIcon />
            Filtrar
          </Button>
          {filtered ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/historial">Limpiar</Link>
            </Button>
          ) : null}
        </div>
      </form>

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
                    {item.status === 'VOIDED' ? (
                      <Badge variant="outline">Eliminado</Badge>
                    ) : (
                      <Badge variant="success">
                        <LockIcon />
                        Cerrado
                      </Badge>
                    )}
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {filters.page > 1 || list.hasMore ? (
        <div className="mt-4 flex justify-between">
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
