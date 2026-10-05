'use client';

import {
  BugIcon,
  CheckCircle2Icon,
  LightbulbIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SendIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState, useTransition } from 'react';
import { sendFeedbackAction } from '@/app/feedback/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  FEEDBACK_CATEGORIES,
  FEEDBACK_LIMITS,
  type FeedbackCategory,
} from '@/lib/feedback/view';
import { cn } from '@/lib/utils';

const ICON: Record<FeedbackCategory, LucideIcon> = {
  BUG: BugIcon,
  SUGGESTION: LightbulbIcon,
  COMMENT: MessageSquareIcon,
};

type Field = 'category' | 'title' | 'description';

/**
 * Formulario de comentarios: tipo, título opcional y descripción. Valida en el navegador con los
 * mismos límites que el servidor (que vuelve a validar todo) y confirma el envío.
 */
export function FeedbackForm({
  signedInAs,
  fromPage,
}: {
  /** Nombre de la sesión (el comentario queda a su nombre); null = se envía sin cuenta. */
  signedInAs: string | null;
  /** Pantalla desde la que vino (?desde=/reparto), si la hay. */
  fromPage: string | null;
}) {
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<{ message: string; field?: Field } | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const length = description.trim().length;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!category) {
      setError({ message: 'Elegí el tipo: error, sugerencia o comentario.', field: 'category' });
      return;
    }
    if (length < FEEDBACK_LIMITS.descriptionMin) {
      setError({
        message: `Contanos un poco más (al menos ${FEEDBACK_LIMITS.descriptionMin} caracteres).`,
        field: 'description',
      });
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await sendFeedbackAction({
        category,
        title,
        description,
        page: fromPage,
        website,
      }).catch(() => ({
        ok: false as const,
        error: 'No se pudo enviar. Revisá tu conexión y probá de nuevo.',
      }));
      if (!result.ok) {
        setError({ message: result.error, ...('field' in result ? { field: result.field } : {}) });
        return;
      }
      setSent(true);
      setCategory(null);
      setTitle('');
      setDescription('');
    });
  }

  if (sent) {
    return (
      <div role="status" className="space-y-4 py-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2Icon className="size-6" />
        </div>
        <div>
          <p className="text-lg font-semibold">¡Gracias! Recibimos tu comentario.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            El equipo de GUTIP lo va a revisar. Nos ayuda mucho a mejorar.
          </p>
        </div>
        <Button variant="outline" onClick={() => setSent(false)}>
          Enviar otro comentario
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset aria-invalid={error?.field === 'category' || undefined}>
        <legend className="mb-2 text-sm font-medium">¿Qué querés contarnos?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {FEEDBACK_CATEGORIES.map((value) => {
            const Icon = ICON[value];
            const selected = category === value;
            return (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50',
                  selected && 'border-primary/60 bg-primary/5',
                  error?.field === 'category' && !category && 'border-destructive',
                )}
              >
                <input
                  type="radio"
                  name="category"
                  value={value}
                  className="sr-only"
                  checked={selected}
                  onChange={() => {
                    setCategory(value);
                    if (error?.field === 'category') setError(null);
                  }}
                />
                <span className="flex items-center gap-2 font-medium">
                  <Icon
                    className={cn('size-4', value === 'BUG' ? 'text-destructive' : 'text-primary')}
                  />
                  {CATEGORY_LABEL[value]}
                </span>
                <span className="text-xs text-muted-foreground">{CATEGORY_HINT[value]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="feedback-title" className="mb-1 block text-sm font-medium">
          Título <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <Input
          id="feedback-title"
          value={title}
          maxLength={FEEDBACK_LIMITS.titleMax}
          placeholder="Ej.: El total no coincide al cerrar"
          aria-invalid={error?.field === 'title' || undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="feedback-description" className="mb-1 block text-sm font-medium">
          Descripción
        </label>
        <textarea
          id="feedback-description"
          rows={6}
          value={description}
          maxLength={FEEDBACK_LIMITS.descriptionMax}
          placeholder={
            category === 'BUG'
              ? 'Qué hiciste, qué esperabas que pasara y qué pasó.'
              : 'Contanos con tus palabras.'
          }
          aria-invalid={error?.field === 'description' || undefined}
          aria-describedby="feedback-description-help"
          className={cn(
            'w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 md:text-sm',
            error?.field === 'description' && 'border-destructive',
          )}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p
          id="feedback-description-help"
          className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground"
        >
          <span>
            No incluyas contraseñas, datos de tarjetas ni datos personales de otras personas.
          </span>
          <span className="tabular shrink-0">
            {length}/{FEEDBACK_LIMITS.descriptionMax}
          </span>
        </p>
      </div>

      {/* Campo trampa para robots: oculto para las personas y los lectores de pantalla. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="feedback-website">No completar</label>
        <input
          id="feedback-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {signedInAs
            ? `Se envía a nombre de ${signedInAs}.`
            : 'Se envía sin nombre: no hace falta tener cuenta.'}
          {fromPage ? ` Desde la pantalla ${fromPage}.` : ''}
        </p>
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
          {pending ? 'Enviando…' : 'Enviar comentario'}
        </Button>
      </div>
    </form>
  );
}
