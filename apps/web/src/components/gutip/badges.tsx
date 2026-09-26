import { CircleDashedIcon, LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type WeekStatus = 'ABIERTA' | 'CERRADA';

export function WeekStatusBadge({ status, className }: { status: WeekStatus; className?: string }) {
  return status === 'CERRADA' ? (
    <Badge variant="success" className={className}>
      <LockIcon />
      Cerrada
    </Badge>
  ) : (
    <Badge variant="warning" className={className}>
      <CircleDashedIcon />
      Abierta
    </Badge>
  );
}

/* Un color por puesto, según su orden. Clases completas para que Tailwind las detecte. */
const TONES = [
  { badge: 'bg-violet-100 text-violet-800 border-violet-200', bar: 'bg-violet-500' },
  { badge: 'bg-amber-100 text-amber-800 border-amber-200', bar: 'bg-amber-500' },
  { badge: 'bg-sky-100 text-sky-800 border-sky-200', bar: 'bg-sky-500' },
  { badge: 'bg-stone-200 text-stone-700 border-stone-300', bar: 'bg-stone-500' },
  { badge: 'bg-rose-100 text-rose-800 border-rose-200', bar: 'bg-rose-500' },
  { badge: 'bg-teal-100 text-teal-800 border-teal-200', bar: 'bg-teal-500' },
  { badge: 'bg-orange-100 text-orange-800 border-orange-200', bar: 'bg-orange-500' },
  { badge: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200', bar: 'bg-fuchsia-500' },
  { badge: 'bg-lime-100 text-lime-800 border-lime-200', bar: 'bg-lime-600' },
  { badge: 'bg-indigo-100 text-indigo-800 border-indigo-200', bar: 'bg-indigo-500' },
] as const;

/** Índice de color de un puesto dentro de la lista de puestos. */
export function toneOf(positions: readonly { id: string }[], positionId: string): number {
  const index = positions.findIndex((p) => p.id === positionId);
  return index < 0 ? 3 : index % TONES.length;
}

export function toneBar(tone: number): string {
  return TONES[tone % TONES.length]?.bar ?? 'bg-stone-500';
}

export function PositionBadge({ name, tone }: { name: string; tone: number }) {
  return (
    <Badge variant="outline" className={TONES[tone % TONES.length]?.badge}>
      {name || 'Sin puesto'}
    </Badge>
  );
}

export function ProvisionalBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn('border-dashed text-muted-foreground', className)}>
      Fórmula provisional
    </Badge>
  );
}
