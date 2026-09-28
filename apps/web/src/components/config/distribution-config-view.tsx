'use client';

import {
  AlertTriangleIcon,
  BriefcaseIcon,
  FlaskConicalIcon,
  HistoryIcon,
  InfoIcon,
  PlusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { PositionBadge, toneOf } from '@/components/gutip/badges';
import { FormulaCard } from '@/components/gutip/formula-card';
import { LoadingState } from '@/components/gutip/loading';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PARAMS, type ParamDefinition } from '@/lib/demo-store/config';
import type { Position } from '@/lib/demo-store/model';
import {
  paramOrigin,
  policyGaps,
  positionsCustomized,
  type PolicyOrigin,
  type PolicyVersion,
} from '@/lib/demo-store/policy';
import type {
  DistributionConfigActions,
  DistributionConfigView as View,
  PolicyVersionView,
} from '@/lib/policy/view';
import { cn } from '@/lib/utils';

const WHEN = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const when = (iso: string) => (iso ? WHEN.format(new Date(iso)) : '—');

const ORIGIN_LABEL: Record<PolicyOrigin, string> = {
  ESTANDAR: 'Estándar',
  COPIA: 'Copia',
  CAMBIO: 'Cambio',
};

/** Pendientes del caso de referencia: se verifican con el restaurante, NO bloquean el cierre. */
const LIBRARY_CHECKS = [
  '"Recepción" y "Cocina" de la planilla: ¿otras fuentes del mismo pozo o pozos aparte?',
  'Porciones de Bacha distintas entre personas: requiere la opción "por puesto, con excepciones" (próximamente).',
  'Redondeo: con pesos enteros se reproducen los 12 importes de la planilla (ya se puede elegir).',
  'Adelantos: ¿se descuentan de toda la semana o solo desde su fecha?',
  'Quién prepara y entrega los sobres.',
  'El archivo Excel original (fórmulas, hojas 2 y 3) y algunas semanas más.',
];

/**
 * Cómo calcula este local: su política versionada (CONFIG-MODEL.md). No sabe de dónde vienen
 * los datos: la demo (`demo-distribution-config.tsx`) y la base (`database-distribution-config.tsx`)
 * le pasan el mismo modelo y las mismas acciones.
 */
export function DistributionConfigView({
  view,
  actions,
}: {
  view: View | null;
  actions: DistributionConfigActions;
}) {
  if (!view) return <LoadingState />;
  const version = view.current;
  const gaps = policyGaps(version);
  const customized =
    PARAMS.filter((p) => paramOrigin(version, p.key) === 'PERSONALIZADO').length +
    (positionsCustomized(version) ? 1 : 0);
  const canEdit = view.canEdit;

  return (
    <>
      <PageHeader
        title="Configuración de distribución"
        description={`Cómo calcula las propinas ${view.venueName}. Solo afecta a este local.`}
        actions={
          <>
            <Badge variant="outline" className="px-3 py-1 text-sm">
              Versión {version.number} vigente
            </Badge>
            <Badge variant={customized > 0 ? 'secondary' : 'success'} className="px-3 py-1 text-sm">
              {customized > 0 ? `${customized} personalizados` : 'Estándar de GUTIP'}
            </Badge>
            {gaps.length > 0 ? (
              <Badge variant="destructive" className="px-3 py-1 text-sm">
                {gaps.length} por definir
              </Badge>
            ) : null}
          </>
        }
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-1 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              Esta es la configuración fija del local.
            </span>{' '}
            Cada cambio crea una nueva versión de la política, que rige para los próximos períodos y
            para la semana abierta. Las semanas cerradas conservan la versión con la que se
            calcularon.
          </p>
          <p>
            La propina de cada semana (el &quot;pozo&quot;), las horas y los adelantos se cargan en{' '}
            <Link
              href={view.source === 'database' ? '/reparto' : '/semana'}
              className="text-primary hover:underline"
            >
              {view.source === 'database' ? 'Repartir propinas' : 'Semana actual'}
            </Link>{' '}
            y no cambian esta configuración. Cuánto le toca a cada persona lo calcula GUTIP.
            {canEdit ? '' : ' Solo el Dueño o el Encargado pueden cambiar la configuración.'}
          </p>
        </div>
      </div>

      {gaps.length > 0 ? (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangleIcon className="size-4" />
            Puntos por definir: se puede guardar y ver la vista previa, pero no cerrar semanas.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <PositionsEditor view={view} canEdit={canEdit} actions={actions} />

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {PARAMS.map((param) => (
          <ParamCard
            key={param.key}
            version={version}
            param={param}
            canEdit={canEdit}
            actions={actions}
            showReference={view.source === 'demo'}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <VersionHistory versions={view.versions} current={version.number} />
        {/* Caso de referencia de un restaurante (Library): solo en la demo, nunca en una cuenta real. */}
        {view.source === 'demo' ? (
          <Card className="self-start">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConicalIcon className="size-4 text-primary" />
                Caso de referencia: Library (Hotel Faena)
              </CardTitle>
              <CardDescription>
                Lo que falta verificar para reproducir la planilla de Library. Es información de
                validación: no bloquea el cierre.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <span className="font-medium">Verificado:</span> con redondeo a pesos enteros y los
                porciones deducidas de la foto de la planilla (23/11/2024), GUTIP reproduce los 12
                importes y el total de $347.990.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {LIBRARY_CHECKS.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <FormulaCard className="mt-6" />
    </>
  );
}

function OriginBadge({ customized }: { customized: boolean }) {
  return customized ? (
    <Badge variant="secondary">Personalizado</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Estándar
    </Badge>
  );
}

function ParamCard({
  version,
  param,
  canEdit,
  actions,
  showReference,
}: {
  version: PolicyVersion;
  param: ParamDefinition;
  canEdit: boolean;
  actions: DistributionConfigActions;
  showReference: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = version.values[param.key];

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{param.label}</CardTitle>
        <CardDescription>{param.question}</CardDescription>
        <CardAction>
          <OriginBadge customized={paramOrigin(version, param.key) === 'PERSONALIZADO'} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <fieldset className="space-y-2" disabled={!canEdit || pending}>
          <legend className="sr-only">{param.label}</legend>
          {param.options.map((option) => {
            const selected = option.value === current;
            return (
              <label
                key={option.value}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                  selected && 'border-primary/50 bg-primary/5',
                  !option.supported && 'opacity-60',
                  canEdit && option.supported && !selected && 'cursor-pointer hover:bg-muted/50',
                )}
              >
                <input
                  type="radio"
                  name={param.key}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={selected}
                  disabled={!option.supported}
                  onChange={() =>
                    startTransition(async () => {
                      setError(await actions.setValue(param.key, option.value));
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {option.label}
                    {!option.supported ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Próximamente
                      </Badge>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
        {param.dependsOn ? (
          <p className="text-xs text-muted-foreground">{param.dependsOn}</p>
        ) : null}
        {showReference ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Referencia Library:</span> {param.library}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PositionsEditor({
  view,
  canEdit,
  actions,
}: {
  view: View;
  canEdit: boolean;
  actions: DistributionConfigActions;
}) {
  const version = view.current;
  const [name, setName] = useState('');
  const [factor, setFactor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const failure = await actions.addPosition(name, factor);
      setError(failure);
      if (!failure) {
        setName('');
        setFactor('');
      }
    });
  }

  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <BriefcaseIcon className="size-4 text-primary" />
          Puestos y porciones
        </CardTitle>
        <CardDescription>
          La porción por hora define cuánto vale cada hora trabajada en ese puesto (provisional).
          Cambiar una porción o agregar un puesto crea una nueva versión de la política.
        </CardDescription>
        <CardAction>
          <OriginBadge customized={positionsCustomized(version)} />
        </CardAction>
      </CardHeader>
      <ul className="divide-y border-t">
        {version.positions.map((position) => (
          <PositionRow
            key={position.id}
            position={position}
            positions={version.positions}
            people={view.peopleByPosition[position.id] ?? 0}
            canEdit={canEdit}
            actions={actions}
          />
        ))}
      </ul>
      {canEdit ? (
        <form onSubmit={submit} className="space-y-2 border-t bg-muted/30 px-5 py-4">
          <p className="text-sm font-medium">Nuevo puesto</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Nombre del puesto"
              placeholder="Ej.: Cocina"
              className="sm:max-w-xs"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            <Input
              aria-label="Porción del puesto"
              inputMode="decimal"
              placeholder="0,015"
              className="tabular sm:w-32"
              value={factor}
              onChange={(event) => {
                setFactor(event.target.value);
                setError(null);
              }}
            />
            <Button type="submit" variant="outline" disabled={pending}>
              <PlusIcon />
              Agregar puesto
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}

function PositionRow({
  position,
  positions,
  people,
  canEdit,
  actions,
}: {
  position: Position;
  positions: readonly Position[];
  people: number;
  canEdit: boolean;
  actions: DistributionConfigActions;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(position.factor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const failure = await actions.setPortion(position.id, value);
      setError(failure);
      if (!failure) setEditing(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <PositionBadge name={position.name} tone={toneOf(positions, position.id)} />
      <span className="text-muted-foreground">
        {people} {people === 1 ? 'persona' : 'personas'}
      </span>
      {editing ? (
        <form onSubmit={submit} className="ml-auto flex items-center gap-2">
          <Input
            aria-label={`Porción de ${position.name}`}
            inputMode="decimal"
            className="tabular h-8 w-28 text-right"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            autoFocus
          />
          <Button type="submit" size="sm" disabled={pending}>
            Guardar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setValue(position.factor);
              setError(null);
            }}
          >
            Cancelar
          </Button>
        </form>
      ) : (
        <span className="ml-auto flex items-center gap-3">
          <span className="tabular font-medium">porción {position.factor}</span>
          {canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Cambiar
            </Button>
          ) : null}
        </span>
      )}
      {error ? (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Todas las versiones de la política, y cuántas semanas cerradas usó cada una. */
function VersionHistory({
  versions: all,
  current,
}: {
  versions: readonly PolicyVersionView[];
  current: number;
}) {
  const versions = [...all].sort((a, b) => b.number - a.number);

  return (
    <Card className="gap-0 self-start pb-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-primary" />
          Historial de la política
        </CardTitle>
        <CardDescription>
          Las versiones no se editan: cada cambio agrega una. Cada semana cerrada queda asociada a
          la versión con la que se calculó.
        </CardDescription>
      </CardHeader>
      <ol className="divide-y border-t">
        {versions.map((version) => {
          const closed = version.closedPeriods;
          return (
            <li key={version.number} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Versión {version.number}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  {ORIGIN_LABEL[version.origin]}
                </Badge>
                {version.number === current ? <Badge variant="success">Vigente</Badge> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {closed} {closed === 1 ? 'semana cerrada' : 'semanas cerradas'}
                </span>
              </div>
              <p className="mt-0.5">{version.summary}</p>
              <p className="text-xs text-muted-foreground">
                {version.createdBy} · {when(version.createdAt)}
              </p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
