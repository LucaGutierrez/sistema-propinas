/**
 * Filtros del historial desde la URL (?estado=&desde=&hasta=&persona=&pagina=). Sin estado se ven
 * los cerrados: los eliminados (anulados) solo con `estado=VOIDED` o `estado=TODOS`. Lo que no es
 * válido se ignora (nunca rompe la pantalla): el historial es de solo lectura y los filtros solo
 * acotan una consulta que igual está limitada al restaurante (y a la persona, para SELF).
 */
import { isIsoDate } from '@/lib/dates';
import type { HistoryFilters } from './view';

export const HISTORY_PAGE_SIZE = 20;
const MAX_PAGE = 500;
const MAX_NAME = 80;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

export function parseHistoryFilters(params: Params): HistoryFilters {
  const status = first(params.estado).toUpperCase();
  const from = first(params.desde);
  const to = first(params.hasta);
  const employee = first(params.persona).slice(0, MAX_NAME);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    status: status === 'TODOS' ? null : status === 'VOIDED' ? 'VOIDED' : 'CLOSED',
    from: isIsoDate(from) ? from : null,
    to: isIsoDate(to) ? to : null,
    employee: employee === '' ? null : employee,
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

/** URL del historial con estos filtros (para paginar sin perderlos). */
export function historyHref(filters: HistoryFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.status !== 'CLOSED') query.set('estado', filters.status ?? 'TODOS');
  if (filters.from) query.set('desde', filters.from);
  if (filters.to) query.set('hasta', filters.to);
  if (filters.employee) query.set('persona', filters.employee);
  if (page > 1) query.set('pagina', String(page));
  const text = query.toString();
  return text ? `/historial?${text}` : '/historial';
}
