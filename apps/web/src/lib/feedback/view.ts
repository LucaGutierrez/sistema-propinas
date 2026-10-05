/**
 * Comentarios de testers: lo que muestran las pantallas "Enviar comentarios" y "Comentarios
 * recibidos", y los filtros de la revisión desde la URL (?tipo=&estado=&pagina=). Sin base.
 */

export const FEEDBACK_CATEGORIES = ['BUG', 'SUGGESTION', 'COMMENT'] as const;
export const FEEDBACK_STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED'] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  BUG: 'Error',
  SUGGESTION: 'Sugerencia',
  COMMENT: 'Comentario',
};

export const CATEGORY_HINT: Record<FeedbackCategory, string> = {
  BUG: 'Algo no funciona o da un resultado equivocado.',
  SUGGESTION: 'Una idea para mejorar GUTIP.',
  COMMENT: 'Cualquier otra opinión.',
};

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  NEW: 'Nuevo',
  IN_REVIEW: 'En revisión',
  RESOLVED: 'Resuelto',
};

/** Largos que aceptan el formulario, el servidor y la base (ck_feedback_*). */
export const FEEDBACK_LIMITS = { titleMax: 120, descriptionMin: 10, descriptionMax: 4000 } as const;

export interface FeedbackItem {
  id: string;
  category: FeedbackCategory;
  title: string | null;
  description: string;
  /** Pantalla desde la que se envió ("/reparto"). */
  page: string | null;
  status: FeedbackStatus;
  createdAt: string;
  /** Nombre de quien lo envió; null si fue sin cuenta. */
  authorName: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
}

export interface FeedbackFilters {
  category: FeedbackCategory | null;
  status: FeedbackStatus | null;
  page: number;
}

export interface FeedbackList {
  items: FeedbackItem[];
  hasMore: boolean;
  /** Cuántos hay de cada tipo y estado (sin filtros), para los contadores. */
  counts: { category: Record<FeedbackCategory, number>; status: Record<FeedbackStatus, number> };
}

export const FEEDBACK_PAGE_SIZE = 30;
const MAX_PAGE = 500;

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim().toUpperCase() ?? '';

/** Lo que no es válido se ignora (la pantalla nunca se rompe por un filtro). */
export function parseFeedbackFilters(params: Params): FeedbackFilters {
  const category = first(params.tipo);
  const status = first(params.estado);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    category: (FEEDBACK_CATEGORIES as readonly string[]).includes(category)
      ? (category as FeedbackCategory)
      : null,
    status: (FEEDBACK_STATUSES as readonly string[]).includes(status)
      ? (status as FeedbackStatus)
      : null,
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

export function feedbackHref(filters: Partial<FeedbackFilters>, page = filters.page ?? 1): string {
  const query = new URLSearchParams();
  if (filters.category) query.set('tipo', filters.category);
  if (filters.status) query.set('estado', filters.status);
  if (page > 1) query.set('pagina', String(page));
  const text = query.toString();
  return text ? `/feedback/revisar?${text}` : '/feedback/revisar';
}

/** Pantalla de origen segura: solo una ruta interna ("/reparto"), sin query ni dominio. */
export function safeFeedbackPage(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.split(/[?#]/)[0] ?? '';
  return /^\/[A-Za-z0-9/_-]{0,199}$/.test(path) && !path.startsWith('//') ? path : null;
}
