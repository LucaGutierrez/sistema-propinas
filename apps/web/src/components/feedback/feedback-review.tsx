'use client';

import {
  BugIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteFeedbackAction, setFeedbackStatusAction } from '@/app/feedback/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { nativeSelectClass } from '@/components/ui/native-select';
import {
  CATEGORY_LABEL,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  feedbackHref,
  STATUS_LABEL,
  type FeedbackCategory,
  type FeedbackFilters,
  type FeedbackItem,
  type FeedbackList,
  type FeedbackStatus,
} from '@/lib/feedback/view';
import { cn } from '@/lib/utils';

const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});

/** Cada tipo con su ícono y color: los errores se distinguen a primera vista. */
const CATEGORY_STYLE: Record<FeedbackCategory, { icon: LucideIcon; className: string }> = {
  BUG: { icon: BugIcon, className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  SUGGESTION: { icon: LightbulbIcon, className: 'border-primary/30 bg-primary/10 text-primary' },
  COMMENT: { icon: MessageSquareIcon, className: 'text-muted-foreground' },
};

const STATUS_VARIANT: Record<FeedbackStatus, 'warning' | 'secondary' | 'success'> = {
  NEW: 'warning',
  IN_REVIEW: 'secondary',
  RESOLVED: 'success',
};

function CategoryBadge({ category }: { category: FeedbackCategory }) {
  const style = CATEGORY_STYLE[category];
  return (
    <Badge variant="outline" className={style.className}>
      <style.icon />
      {CATEGORY_LABEL[category]}
    </Badge>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm transition-colors md:min-h-8',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted/60',
      )}
    >
      {children}
    </Link>
  );
}

/** "Comentarios recibidos": filtros por tipo y estado, lista, cambio de estado y borrado. */
export function FeedbackReview({
  list,
  filters,
}: {
  list: FeedbackList;
  filters: FeedbackFilters;
}) {
  const total = Object.values(list.counts.category).reduce((a, b) => a + b, 0);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Comentarios recibidos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que enviaron quienes prueban GUTIP, del más reciente al más antiguo.{' '}
          {list.counts.status.NEW > 0
            ? `${list.counts.status.NEW} ${list.counts.status.NEW === 1 ? 'nuevo' : 'nuevos'} sin revisar.`
            : 'No hay comentarios nuevos sin revisar.'}
        </p>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar por tipo">
          <span className="w-full text-xs font-medium text-muted-foreground sm:w-14">Tipo</span>
          <FilterLink href={feedbackHref({ status: filters.status })} active={!filters.category}>
            Todos ({total})
          </FilterLink>
          {FEEDBACK_CATEGORIES.map((c) => (
            <FilterLink
              key={c}
              href={feedbackHref({ category: c, status: filters.status })}
              active={filters.category === c}
            >
              {CATEGORY_LABEL[c]} ({list.counts.category[c]})
            </FilterLink>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar por estado">
          <span className="w-full text-xs font-medium text-muted-foreground sm:w-14">Estado</span>
          <FilterLink href={feedbackHref({ category: filters.category })} active={!filters.status}>
            Todos
          </FilterLink>
          {FEEDBACK_STATUSES.map((s) => (
            <FilterLink
              key={s}
              href={feedbackHref({ category: filters.category, status: s })}
              active={filters.status === s}
            >
              {STATUS_LABEL[s]} ({list.counts.status[s]})
            </FilterLink>
          ))}
        </div>
      </div>

      {list.items.length === 0 ? (
        <Card className="text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <MessagesSquareIcon className="size-5" />
            </div>
            <CardTitle>
              {filters.category || filters.status ? 'Sin resultados' : 'Todavía no hay comentarios'}
            </CardTitle>
            <CardDescription>
              {filters.category || filters.status
                ? 'Ningún comentario coincide con esos filtros.'
                : 'Cuando alguien envíe uno desde "Enviar comentarios", va a aparecer acá.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.items.map((item) => (
            <FeedbackCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      {filters.page > 1 || list.hasMore ? (
        <div className="mt-4 flex justify-between gap-2">
          {filters.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={feedbackHref(filters, filters.page - 1)}>Más recientes</Link>
            </Button>
          ) : (
            <span />
          )}
          {list.hasMore ? (
            <Button asChild variant="outline" size="sm">
              <Link href={feedbackHref(filters, filters.page + 1)}>Más antiguos</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FeedbackCard({ item }: { item: FeedbackItem }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await task().catch(() => ({
        ok: false,
        error: 'No se pudo guardar. Revisá tu conexión y probá de nuevo.',
      }));
      if (!result.ok) {
        setError(result.error ?? 'No se pudo guardar.');
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'rounded-xl border bg-card p-4',
        item.category === 'BUG' && item.status !== 'RESOLVED' && 'border-l-4 border-l-destructive',
        item.status === 'RESOLVED' && 'opacity-80',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge category={item.category} />
        <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        <span className="text-xs text-muted-foreground">
          {dateTime.format(new Date(item.createdAt))} · {item.authorName ?? 'Sin cuenta'}
          {item.page ? ` · desde ${item.page}` : ''}
        </span>
      </div>
      {item.title ? <p className="mt-2 font-medium">{item.title}</p> : null}
      <p className="mt-1 text-sm whitespace-pre-wrap">{item.description}</p>

      <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <label htmlFor={`status-${item.id}`} className="text-muted-foreground">
            Estado
          </label>
          <select
            id={`status-${item.id}`}
            className={cn(nativeSelectClass, 'min-w-0 flex-1 sm:w-auto sm:flex-none')}
            value={item.status}
            disabled={pending}
            onChange={(e) => {
              const status = e.target.value;
              run(() => setFeedbackStatusAction(item.id, status));
            }}
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {pending ? (
            <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          {item.statusChangedAt && item.statusChangedBy ? (
            <span className="w-full text-xs text-muted-foreground sm:w-auto">
              por {item.statusChangedBy}, {dateTime.format(new Date(item.statusChangedAt))}
            </span>
          ) : null}
        </div>
        {confirming ? (
          <div
            role="group"
            aria-label="Confirmar borrado"
            className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
          >
            <span className="text-sm">¿Borrar este comentario? No se puede deshacer.</span>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => run(() => deleteFeedbackAction(item.id))}
              >
                {pending ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
                Sí, borrar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="self-start text-muted-foreground sm:self-auto"
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon />
            Borrar
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
