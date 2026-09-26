'use client';

import {
  AlertTriangleIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  ClockIcon,
  LockIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DistributionTable } from '@/components/distribution/distribution-table';
import {
  PositionBadge,
  ProvisionalBadge,
  WeekStatusBadge,
  toneOf,
} from '@/components/gutip/badges';
import { FormulaCard } from '@/components/gutip/formula-card';
import { LoadingState } from '@/components/gutip/loading';
import { StatCard } from '@/components/gutip/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDayMonth, formatWeekRange, formatWeekday, todayIso, weekDays } from '@/lib/dates';
import { formatMoney, formatMoneyShort, parseMoney } from '@/lib/decimal';
import {
  calculateWeek,
  closeWeek,
  openWeek,
  weekPolicy,
  activeAdvances,
  advanceTotal,
  setDailyTip,
  setHours,
  sortedWeeks,
  startWeek,
  suggestedStartDate,
  weekTotal,
  type Venue,
  type Week,
} from '@/lib/demo-store/model';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import { policyGaps } from '@/lib/demo-store/policy';
import { previewRowsView } from '@/lib/demo-store/views';
import { AdvancesCard } from './advances-card';
import { RevisionNotice } from './revision-notice';
import { WeekPolicyNotice } from './week-policy-notice';
import type { ProvisionalResult } from '@/lib/distribution/provisional-formula';
import { cn } from '@/lib/utils';

export function CurrentWeek() {
  const { venue } = useDemoStore();
  if (!venue) return <LoadingState />;
  const week = openWeek(venue);
  return week ? <OpenWeek venue={venue} week={week} /> : <StartWeek venue={venue} />;
}

function StartWeek({ venue }: { venue: Venue }) {
  const { apply, perms } = useDemoStore();
  const [startDate, setStartDate] = useState(() => suggestedStartDate(venue, todayIso()));
  const [error, setError] = useState<string | null>(null);
  const lastClosed = sortedWeeks(venue).find((week) => week.status === 'CERRADA');

  if (!perms.editWeek) {
    return (
      <>
        <PageHeader title="Semana actual" description="No hay ninguna semana abierta." />
        <Card className="mx-auto max-w-xl text-center">
          <CardHeader>
            <CardTitle>Todavía no empezó la semana</CardTitle>
            <CardDescription>
              Cuando el encargado la empiece, vas a ver acá los pozos de cada día.
            </CardDescription>
          </CardHeader>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Semana actual" description="No hay ninguna semana abierta." />
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarPlusIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Empezar una semana</CardTitle>
          <CardDescription>
            Cada día anotás el pozo. Al terminar la semana cargás las horas de cada persona, cerrás
            la semana y el sistema calcula el sobre de cada uno.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inicio">Primer día de la semana</Label>
            <Input
              id="inicio"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setError(null);
              }}
            />
            {startDate ? (
              <p className="text-xs text-muted-foreground">{formatWeekRange(startDate)}</p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            size="lg"
            className="w-full"
            onClick={() =>
              setError(
                apply((s) => startWeek(s, startDate, newId('semana'), new Date().toISOString())),
              )
            }
          >
            <CalendarPlusIcon />
            Empezar semana
          </Button>
          {lastClosed ? (
            <p className="text-center text-sm text-muted-foreground">
              Última semana cerrada:{' '}
              <Link href={`/semanas/${lastClosed.id}`} className="text-primary hover:underline">
                {formatWeekRange(lastClosed.startDate)}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function OpenWeek({ venue, week }: { venue: Venue; week: Week }) {
  const { apply, perms } = useDemoStore();
  const readOnly = !perms.editWeek;
  const router = useRouter();
  const [calculation, setCalculation] = useState<{ result: ProvisionalResult; key: string } | null>(
    null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const days = weekDays(week.startDate);
  const today = todayIso();
  const total = weekTotal(week);
  const activeStaff = venue.staff.filter((member) => member.active);
  // Versión de la política fijada a esta semana: define puestos, pesos y redondeo del cálculo.
  const policy = weekPolicy(venue, week);
  const gaps = policyGaps(policy);
  const inputsKey = useMemo(
    () => JSON.stringify({ week, staff: venue.staff, policy: policy.number }),
    [week, venue.staff, policy.number],
  );
  const stale = calculation !== null && calculation.key !== inputsKey;
  const result = stale ? null : (calculation?.result ?? null);
  const maxDayCents = days.reduce((max, date) => {
    const cents = parseMoney(week.tips[date] ?? '') ?? 0n;
    return cents > max ? cents : max;
  }, 0n);
  const hoursLoaded = activeStaff.filter((m) => (week.hours[m.id] ?? '').trim() !== '').length;

  function edit(action: (s: Venue) => ReturnType<typeof setHours>) {
    const error = apply(action);
    setConfirming(false);
    if (error) setErrors([error]);
  }

  function calculate() {
    const outcome = calculateWeek(venue, week);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      setCalculation(null);
      return;
    }
    setErrors([]);
    setCalculation({ result: outcome.result, key: inputsKey });
  }

  function close() {
    const error = apply((s) => closeWeek(s, week.id, new Date().toISOString()));
    if (error) {
      setErrors([error]);
      setConfirming(false);
      return;
    }
    router.push(`/semanas/${week.id}`);
  }

  return (
    <>
      <PageHeader
        title="Semana actual"
        description={formatWeekRange(week.startDate)}
        actions={
          <>
            <ProvisionalBadge />
            <WeekStatusBadge status={week.status} className="px-3 py-1 text-sm" />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Pozo acumulado"
          value={formatMoneyShort(total.totalCents)}
          hint="Suma de los días cargados"
          icon={WalletIcon}
          tone="primary"
        />
        <StatCard
          label="Días con pozo"
          value={`${total.daysWithTips} / 7`}
          icon={CalendarDaysIcon}
        />
        <StatCard
          label="Promedio por día"
          value={
            total.daysWithTips > 0
              ? formatMoneyShort(total.totalCents / BigInt(total.daysWithTips))
              : '—'
          }
          hint="De los días cargados"
          icon={TrendingUpIcon}
        />
        <StatCard
          label="Horas cargadas"
          value={`${hoursLoaded} / ${activeStaff.length}`}
          hint="Personas con horas"
          icon={ClockIcon}
        />
      </div>

      {week.note ? <p className="mt-4 text-sm text-muted-foreground">{week.note}</p> : null}
      <RevisionNotice week={week} />
      <WeekPolicyNotice venue={venue} week={week} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Pozo diario */}
        <Card className="gap-0 pb-2 xl:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle>Pozo de cada día</CardTitle>
            <CardDescription>Lo que se juntó cada día. Se guarda automáticamente.</CardDescription>
          </CardHeader>
          <ul className="divide-y border-t">
            {days.map((date) => {
              const value = week.tips[date] ?? '';
              const cents = parseMoney(value);
              const invalid = value.trim() !== '' && cents === null;
              const width = cents && maxDayCents > 0n ? Number((cents * 100n) / maxDayCents) : 0;
              return (
                <li key={date} className={cn('px-5 py-2.5', date === today && 'bg-primary/5')}>
                  <div className="flex items-center gap-3">
                    <div className="w-24 shrink-0">
                      <p className="text-sm font-medium capitalize">{formatWeekday(date)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDayMonth(date)}
                        {date === today ? ' · hoy' : ''}
                      </p>
                    </div>
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        aria-label={`Pozo del ${formatWeekday(date)} ${formatDayMonth(date)}`}
                        aria-invalid={invalid || undefined}
                        inputMode="decimal"
                        placeholder="0"
                        className="tabular pl-7 text-right"
                        value={value}
                        disabled={readOnly}
                        onChange={(event) =>
                          edit((s) => setDailyTip(s, week.id, date, event.target.value))
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 ml-27 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-[width]"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="tabular flex items-center justify-between px-5 pt-3 text-sm font-medium">
            <span>Total de la semana</span>
            <span className="text-lg">{formatMoney(total.totalCents)}</span>
          </div>
        </Card>

        {/* Horas y adelantos */}
        <Card className="gap-0 pb-0 xl:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle>Horas y adelantos de la semana</CardTitle>
            <CardDescription>
              Cargá el total de horas de cada persona al cerrar la semana.
            </CardDescription>
          </CardHeader>
          <div className="border-t">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Empleado</TableHead>
                  <TableHead>Puesto</TableHead>
                  <TableHead className="text-right">Factor</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="pr-5 text-right">Adelanto $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeStaff.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-8 text-center whitespace-normal">
                      <span className="text-muted-foreground">
                        Este local todavía no tiene personal.{' '}
                      </span>
                      <Link href="/personal" className="text-primary hover:underline">
                        Agregar personal
                      </Link>
                    </TableCell>
                  </TableRow>
                ) : null}
                {activeStaff.map((member) => {
                  const position = policy.positions.find((p) => p.id === member.positionId);
                  const advance = advanceTotal(week, member.id);
                  const carried = activeAdvances(week)
                    .filter((e) => e.staffId === member.id && e.origin === 'SALDO_ANTERIOR')
                    .reduce((sum, e) => sum + BigInt(e.amountCents), 0n);
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="pl-5 font-medium">{member.name}</TableCell>
                      <TableCell>
                        <PositionBadge
                          name={position?.name ?? ''}
                          tone={toneOf(policy.positions, member.positionId)}
                        />
                      </TableCell>
                      <TableCell className="tabular text-right text-muted-foreground">
                        {position?.factor ?? '—'}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          aria-label={`Horas de ${member.name}`}
                          inputMode="decimal"
                          placeholder="0"
                          className="tabular ml-auto h-8 w-20 text-right"
                          value={week.hours[member.id] ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            edit((s) => setHours(s, week.id, member.id, event.target.value))
                          }
                        />
                      </TableCell>
                      <TableCell className="tabular py-1.5 pr-5 text-right">
                        {advance > 0n ? (
                          formatMoney(advance)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {carried > 0n ? (
                          <p className="mt-0.5 text-xs text-warning-foreground">
                            incluye saldo anterior {formatMoney(carried)}
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
            <UsersIcon className="size-3.5" />
            ¿Falta alguien?{' '}
            <Link href="/personal" className="text-primary hover:underline">
              Agregalo en Personal
            </Link>
          </div>
        </Card>
      </div>

      <AdvancesCard venue={venue} week={week} className="mt-6" />

      {/* Acciones */}
      <div className="sticky bottom-3 z-10 mt-6">
        <div className="flex flex-col gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {!perms.editWeek
              ? 'Solo lectura: podés calcular la vista previa, pero no modificar.'
              : confirming
                ? `¿Cerrar la semana y repartir ${formatMoney(total.totalCents)}? Después no se podrá modificar.`
                : stale
                  ? 'Cambiaste datos: volvé a calcular antes de cerrar.'
                  : gaps.length > 0
                    ? 'La política tiene puntos por definir: no se puede cerrar todavía.'
                    : !perms.closeWeek
                      ? 'Cargá los datos. El encargado es quien cierra la semana.'
                      : result
                        ? 'Revisá los sobres y cerrá la semana.'
                        : 'Cuando esté todo cargado, presioná Calcular.'}
          </p>
          <div className="flex gap-2">
            {confirming ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => setConfirming(false)}
                >
                  Cancelar
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={close}>
                  <LockIcon />
                  Confirmar cierre
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant={result ? 'outline' : 'default'}
                  className="flex-1 sm:flex-none"
                  onClick={calculate}
                >
                  <CalculatorIcon />
                  Calcular
                </Button>
                {perms.closeWeek ? (
                  <Button
                    variant={result ? 'default' : 'outline'}
                    className="flex-1 sm:flex-none"
                    onClick={() => setConfirming(true)}
                    disabled={!result || gaps.length > 0}
                  >
                    <LockIcon />
                    Cerrar semana
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {errors.length > 0 ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangleIcon className="size-4" />
            Revisá estos datos
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <Card className="mt-6 gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>Vista previa de los sobres</CardTitle>
            <CardDescription>
              Pozo de la semana {formatMoney(result.totalCents)} · todavía no está cerrada.
            </CardDescription>
          </CardHeader>
          <DistributionTable
            rows={previewRowsView(venue, result)}
            totals={{
              totalCents: result.totalCents,
              totalPointsE6: result.totalPointsE6,
              totalAdvanceCents: result.totalAdvanceCents,
              totalFinalCents: result.totalFinalCents,
            }}
          />
        </Card>
      ) : null}

      <FormulaCard className="mt-6" />
    </>
  );
}
