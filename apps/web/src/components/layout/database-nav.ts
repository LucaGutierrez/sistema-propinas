/**
 * Menú del modo base de datos: SOLO pantallas que leen la base. Las que todavía son de la demo
 * (Semana, Historial, Acceso, Mis sobres, Mis locales) no aparecen: un usuario real nunca ve datos
 * ficticios. Sin dependencias de la demo (lo verifica un test).
 */
import {
  HandCoinsIcon,
  LayoutDashboardIcon,
  MailIcon,
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
  { href: '/sobres', label: 'Sobres', icon: MailIcon },
  { href: '/personal', label: 'Personal', icon: UsersIcon },
  { href: '/configuracion', label: 'Configuración de distribución', icon: SlidersHorizontalIcon },
];

/** Secciones de la cuenta. */
export const DATABASE_ACCOUNT_NAV: readonly DatabaseNavItem[] = [
  { href: '/cuenta', label: 'Mi sesión', icon: UserRoundIcon },
  { href: '/crear-restaurante', label: 'Crear restaurante', icon: PlusIcon },
];

/**
 * Rutas de la demo: en modo base muestran "todavía no disponible" o redirigen (Semana → Reparto,
 * Mis locales → Mi sesión).
 */
export const DEMO_ONLY_ROUTES = ['/semana', '/historial', '/acceso', '/mis-sobres', '/locales'];

export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
