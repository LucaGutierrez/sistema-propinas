import {
  CalendarDaysIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MailIcon,
  ShieldCheckIcon,
  StoreIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import type { Permissions } from '@/lib/demo-store/permissions';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const HOME: NavItem = { href: '/', label: 'Inicio', icon: LayoutDashboardIcon };
const WEEK: NavItem = { href: '/semana', label: 'Semana actual', icon: CalendarDaysIcon };
const HISTORY: NavItem = { href: '/historial', label: 'Historial', icon: HistoryIcon };
const STAFF: NavItem = { href: '/personal', label: 'Personal', icon: UsersIcon };
const MY_ENVELOPES: NavItem = { href: '/mis-sobres', label: 'Mis sobres', icon: MailIcon };
const ACCESS: NavItem = { href: '/acceso', label: 'Acceso', icon: ShieldCheckIcon };
const VENUES: NavItem = { href: '/locales', label: 'Mis locales', icon: StoreIcon };

/** Secciones del local activo según el permiso. */
export function venueNav(perms: Permissions): NavItem[] {
  if (!perms.viewAll) return [MY_ENVELOPES];
  const items = [HOME, WEEK, HISTORY, STAFF];
  if (perms.ownStaffId) items.push(MY_ENVELOPES);
  if (perms.manageAccess) items.push(ACCESS);
  return items;
}

/** Secciones de la cuenta (todos los locales): solo para el dueño de la cuenta. */
export function accountNav(isOwner: boolean): NavItem[] {
  return isOwner ? [VENUES] : [];
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  // El detalle de una semana cerrada (/semanas/…) se muestra dentro de Historial.
  if (href === '/historial' && pathname.startsWith('/semanas/')) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
