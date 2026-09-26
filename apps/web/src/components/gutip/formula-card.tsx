import { InfoIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const STEPS = [
  ['Pozo', 'suma de los pozos de cada día de la semana'],
  ['Puntos', 'horas de la semana × porción del puesto'],
  ['Porcentaje', 'puntos ÷ total de puntos'],
  ['Importe', 'pozo × porcentaje'],
  ['Sobre', 'importe − adelantos'],
] as const;

/** Explica la fórmula en uso y deja claro que es provisional. */
export function FormulaCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-warning/60 bg-warning/10 p-4 text-sm sm:p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-warning-foreground">Fórmula provisional</p>
          <p className="mt-1 text-muted-foreground">
            Todavía estamos validando la fórmula exacta de la planilla histórica. Los importes son
            orientativos.{' '}
            <Link
              href="/configuracion"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Ver la configuración de este local
            </Link>
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {STEPS.map(([term, definition]) => (
              <div key={term} className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{term}</dt>
                <dd className="text-muted-foreground">= {definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
