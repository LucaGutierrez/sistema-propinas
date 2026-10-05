/**
 * Menú del modo base de datos: SOLO pantallas que leen la base. Las que todavía son de la demo
 * (Semana, Historial, Acceso, Mis sobres, Mis locales) no aparecen: un usuario real nunca ve datos
 * ficticios. Sin dependencias de la demo (lo verifica un test).
 */
import {
  HandCoinsIcon,
  HistoryIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MailIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

export interface DatabaseNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Secciones del restaurante activo. */
export const DATABASE_VENUE_NAV: readonly DatabaseNavItem[] = [
  { href: '/', label: 'Inicio', icon: LayoutDashboardIcon },
  { href: '/reparto', label: 'Repartir propinas', icon: HandCoinsIcon },
  { href: '/historial', label: 'Historial', icon: HistoryIcon },
  { href: '/sobres', label: 'Sobres', icon: MailIcon },
  { href: '/personal', label: 'Personal', icon: UsersIcon },
  { href: '/configuracion', label: 'Configuración de distribución', icon: SlidersHorizontalIcon },
];

/** Enviar comentarios: también sin sesión (es una ruta pública). */
export const FEEDBACK_SEND_NAV: DatabaseNavItem = {
  href: '/feedback',
  label: 'Enviar comentarios',
  icon: MessageSquarePlusIcon,
};

/** Secciones de la cuenta. */
export const DATABASE_ACCOUNT_NAV: readonly DatabaseNavItem[] = [
  { href: '/cuenta', label: 'Mi sesión', icon: UserRoundIcon },
  { href: '/crear-restaurante', label: 'Crear restaurante', icon: PlusIcon },
  FEEDBACK_SEND_NAV,
];

/** Solo para quien revisa los comentarios (GUTIP_FEEDBACK_REVIEWERS). */
export const FEEDBACK_REVIEW_NAV: DatabaseNavItem = {
  href: '/feedback/revisar',
  label: 'Comentarios recibidos',
  icon: InboxIcon,
};

/**
 * Rutas de la demo: en modo base muestran "todavía no disponible" o redirigen (Semana → Reparto,
 * Mis sobres → Sobres, Mis locales → Mi sesión). Historial ya es real en modo base.
 */
export const DEMO_ONLY_ROUTES = ['/semana', '/acceso', '/mis-sobres', '/locales'];

export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  // "Enviar comentarios" no se marca dentro de "Comentarios recibidos".
  if (href === '/feedback') return pathname === '/feedback';
  return pathname === href || pathname.startsWith(`${href}/`);
}
