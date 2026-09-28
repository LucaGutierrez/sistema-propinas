import {
  BanknoteIcon,
  CalendarDaysIcon,
  HandCoinsIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/components/gutip/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import type { RestaurantSummary } from '@/server/restaurants/summary';

/** Inicio con los datos de la base: el restaurante activo y lo que tiene cargado. */
export function DatabaseHome({ summary, role }: { summary: RestaurantSummary; role: string }) {
  return (
    <>
      <PageHeader
        title="Inicio"
        description={`${summary.name} · ${role}${
          summary.policyVersion
            ? ` · política de distribución versión ${summary.policyVersion}`
            : ''
        }`}
        actions={
          <Button asChild variant="outline">
            <Link href="/crear-restaurante">
              <PlusIcon />
              Crear otro restaurante
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Personal activo"
          value={summary.activeEmployees}
          icon={UsersIcon}
          tone="primary"
        />
        <StatCard label="Repartos" value={summary.distributions} icon={WalletIcon} />
        <StatCard label="Semanas" value={summary.periods} icon={CalendarDaysIcon} />
        <StatCard label="Adelantos" value={summary.advances} icon={HandCoinsIcon} />
        <StatCard label="Sobres" value={summary.payments} icon={BanknoteIcon} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/personal">
            <UsersIcon />
            Personal
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/configuracion">
            <SlidersHorizontalIcon />
            Configuración de distribución
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/cuenta">Mi sesión</Link>
        </Button>
      </div>
    </>
  );
}
