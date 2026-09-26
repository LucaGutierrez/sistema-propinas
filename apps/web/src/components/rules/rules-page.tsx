'use client';

import { CircleHelpIcon } from 'lucide-react';
import { PositionBadge, toneOf } from '@/components/gutip/badges';
import { FormulaCard } from '@/components/gutip/formula-card';
import { LoadingState } from '@/components/gutip/loading';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PENDING_DECISIONS } from '@/lib/demo/pending-decisions';
import { useDemoStore } from '@/lib/demo-store/store';

/** Qué calcula GUTIP hoy y qué reglas faltan decidir. Informativo: no cambia nada. */
export function RulesPage() {
  const { venue } = useDemoStore();
  if (!venue) return <LoadingState />;

  return (
    <>
      <PageHeader
        title="Reglas de cálculo"
        description="Cómo calcula GUTIP hoy y qué falta decidir para que coincida con la planilla."
        actions={
          <Badge variant="warning" className="px-3 py-1 text-sm">
            {PENDING_DECISIONS.length} decisiones pendientes
          </Badge>
        }
      />

      <FormulaCard />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="gap-0 pb-0 xl:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <CircleHelpIcon className="size-4 text-warning-foreground" />
              Pendiente de decidir
            </CardTitle>
            <CardDescription>
              Mientras no se decidan, la demo usa el comportamiento de la columna &quot;Hoy&quot;.
              Ninguno es definitivo.
            </CardDescription>
          </CardHeader>
          <ul className="divide-y border-t">
            {PENDING_DECISIONS.map((decision) => (
              <li key={decision.id} className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="tabular font-mono">
                    {decision.id}
                  </Badge>
                  <p className="font-medium">{decision.topic}</p>
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  <div className="rounded-lg bg-muted/60 p-3">
                    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Hoy (provisional)
                    </dt>
                    <dd className="mt-1">{decision.today}</dd>
                  </div>
                  <div className="rounded-lg border border-dashed border-warning/60 bg-warning/10 p-3">
                    <dt className="text-xs font-medium tracking-wide text-warning-foreground uppercase">
                      Falta decidir
                    </dt>
                    <dd className="mt-1">{decision.question}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Factores de {venue.name}</CardTitle>
            <CardDescription>
              Provisionales (P3). Se cambian desde Personal → Puestos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {venue.positions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este local todavía no tiene puestos.</p>
            ) : (
              <ul className="space-y-2">
                {venue.positions.map((position) => (
                  <li key={position.id} className="flex items-center justify-between text-sm">
                    <PositionBadge
                      name={position.name}
                      tone={toneOf(venue.positions, position.id)}
                    />
                    <span className="tabular text-muted-foreground">{position.factor}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
