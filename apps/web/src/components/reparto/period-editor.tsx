'use client';

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleDollarSignIcon,
  ClockIcon,
  LoaderCircleIcon,
  LockIcon,
  SearchIcon,
  UserPlusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import {
  closePeriodAction,
  setDailyTipsAction,
  setHoursAction,
  setTotalTipsAction,
} from '@/app/reparto/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDayMonth, formatShortDate, formatWeekday, weekDays } from '@/lib/dates';
import { formatMoney, parseMoney } from '@/lib/decimal';
import { methodUses } from '@/lib/distribution/participation';
import { buildPeriodPreview, parseHours, type PreviewRow } from '@/lib/distribution/period-preview';
import { formatHoursE2, METHOD_LABEL, type OpenPeriodView } from '@/lib/distribution/period-view';
import { cn } from '@/lib/utils';
import { SectorBreakdown } from '@/components/distribution/sector-breakdown';
import type { SectorsSummary } from '@/lib/distribution/sector-snapshot';
import { AdvancesSection } from './advances-section';
import { CalculationDetail } from './calculation-detail';

type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

/** Centavos → texto para el campo ("34799000" → "347.990"; con centavos "1.234,50"). */
function moneyInput(cents: bigint): string {
  if (cents === 0n) return '';
  const text = formatMoney(cents).replace(/^\$\s/, '');
  return text.endsWith(',00') ? text.slice(0, -3) : text;
}

const SEARCH_FROM = 15;

export function PeriodEditor({ view }: { view: OpenPeriodView }) {
  const router = useRouter();
  const unitCents = BigInt(view.unitCents);
  const days = weekDays(view.weekStart);
  const readOnly = !view.canEdit;

  // ── Propina ──
  const [tipsMode, setTipsMode] = useState(view.tips.mode);
  const [totalText, setTotalText] = useState(moneyInput(BigInt(view.tips.totalCents)));
  const [dayTexts, setDayTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      days.map((d) => [
        d,
        view.tips.mode === 'daily'
          ? moneyInput(BigInt(view.tips.days.find((x) => x.date === d)?.amountCents ?? '0'))
          : '',
      ]),
    ),
  );
  const savedTips = useRef(
    JSON.stringify({ mode: view.tips.mode, total: totalText, days: dayTexts }),
  );

  // ── Horas ──
  const [hours, setHours] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.people.map((p) => [p.employeeId, p.hours ?? ''])),
  );
  const savedHours = useRef<Record<string, string>>({ ...hours });
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [search, setSearch] = useState('');

  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [phase, setPhase] = useState<'edit' | 'review'>('edit');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const pending = useRef(0);

  // ── Cálculo en vivo (la misma función que usa el cierre en el servidor) ──
  const tipsCents =
    tipsMode === 'total'
      ? (parseMoney(totalText) ?? 0n)
      : days.reduce((sum, d) => sum + (parseMoney(dayTexts[d] ?? '') ?? 0n), 0n);
  const tipsInvalid =
    tipsMode === 'total'
      ? totalText.trim() !== '' && parseMoney(totalText) === null
      : days.some(
          (d) => (dayTexts[d] ?? '').trim() !== '' && parseMoney(dayTexts[d] ?? '') === null,
        );
  const preview = useMemo(
    () =>
      buildPeriodPreview({
        totalCents: tipsInvalid ? 0n : tipsCents,
        unitCents,
        method: view.method,
        sectors: view.sectors,
        people: view.people.map((p) => ({
          ...p,
          hours: (hours[p.employeeId] ?? '').trim() === '' ? null : (hours[p.employeeId] ?? ''),
          advanceCents: BigInt(p.advanceCents),
        })),
      }),
    [tipsInvalid, tipsCents, unitCents, view.method, view.sectors, view.people, hours],
  );
  const sectorView: SectorsSummary | null = preview.sectors
    ? { kind: 'steps', ...preview.sectors }
    : null;
  const rowById = new Map(preview.rows.map((r) => [r.employeeId, r]));

  async function track(task: () => Promise<{ ok: boolean; error?: string }>) {
    pending.current += 1;
    setSave({ kind: 'saving' });
    try {
      const result = await task();
      pending.current -= 1;
      if (!result.ok) {
        setSave({ kind: 'error', message: result.error ?? 'No se pudo guardar.' });
        return false;
      }
      if (pending.current === 0) setSave({ kind: 'saved' });
      return true;
    } catch {
      pending.current -= 1;
      setSave({
        kind: 'error',
        message: 'No se pudo guardar. Revisá tu conexión y probá de nuevo.',
      });
      return false;
    }
  }

  async function saveTips(): Promise<boolean> {
    if (readOnly || tipsInvalid) return !tipsInvalid;
    const snapshot = JSON.stringify({ mode: tipsMode, total: totalText, days: dayTexts });
    if (snapshot === savedTips.current) return true;
    const ok = await track(() =>
      tipsMode === 'total'
        ? setTotalTipsAction(view.settlementId, totalText)
        : setDailyTipsAction(
            view.settlementId,
            days.map((date) => ({ date, amount: dayTexts[date] ?? '' })),
          ),
    );
    if (ok) savedTips.current = snapshot;
    return ok;
  }

  async function saveHours(ids: readonly string[], values: Record<string, string>) {
    const changed = ids.filter((id) => (values[id] ?? '') !== (savedHours.current[id] ?? ''));
    const valid = changed.filter((id) => rowStateOf(values[id] ?? '') !== 'invalid');
    if (readOnly || valid.length === 0) return true;
    const ok = await track(() =>
      setHoursAction(
        view.settlementId,
        valid.map((employeeId) => {
          const text = (values[employeeId] ?? '').trim();
          return { employeeId, hours: text === '' ? null : text };
        }),
      ),
    );
    if (ok) for (const id of valid) savedHours.current[id] = values[id] ?? '';
    return ok;
  }

  const visible = view.people.filter((p) =>
    search.trim() === '' ? true : p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function focusNext(employeeId: string) {
    const index = visible.findIndex((p) => p.employeeId === employeeId);
    const next = visible[index + 1];
    if (next) inputs.current[next.employeeId]?.focus();
    else inputs.current[employeeId]?.blur();
  }

  /** Pegar una columna de horas (Excel, Sheets): llena desde esta fila hacia abajo. */
  function paste(employeeId: string, event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text');
    if (!/[\n\t]/.test(text.trim())) return;
    event.preventDefault();
    const values = text
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => (line.split('\t')[0] ?? '').trim());
    while (values.length > 0 && values[values.length - 1] === '') values.pop();
    const start = visible.findIndex((p) => p.employeeId === employeeId);
    const next = { ...hours };
    const ids: string[] = [];
    values.forEach((value, offset) => {
      const person = visible[start + offset];
      if (!person) return;
      next[person.employeeId] = value;
      ids.push(person.employeeId);
    });
    setHours(next);
    void saveHours(ids, next);
  }

  async function review() {
    setCloseError(null);
    const okTips = await saveTips();
    const okHours = await saveHours(
      view.people.map((p) => p.employeeId),
      hours,
    );
    if (!okTips || !okHours) return;
    if (!preview.canClose) {
      // Datos incompletos: se queda en la carga y lleva a lo primero que falta.
      setCloseError(preview.issues[0]?.message ?? 'Faltan datos para cerrar el reparto.');
      const first = preview.issues.find((i) => i.employeeIds.length > 0)?.employeeIds[0];
      if (first) inputs.current[first]?.focus();
      else if (preview.issues[0]?.code === 'NO_TIPS')
        document.getElementById('tips-total')?.focus();
      return;
    }
    setPhase('review');
  }

  async function close() {
    setClosing(true);
    setCloseError(null);
    const result = await closePeriodAction(view.settlementId).catch(() => ({
      ok: false as const,
      error: 'No se pudo cerrar. Revisá tu conexión y probá de nuevo.',
    }));
    if (!result.ok) {
      setClosing(false);
      setCloseError(result.error);
      return;
    }
    router.push(`/reparto/${result.value}?cerrado=1`);
  }

  const missing = preview.rows.filter((r) => r.state === 'missing' && r.active).length;
  const loaded = preview.rows.filter((r) => r.state === 'worked' || r.state === 'zero').length;
  const uses = methodUses(view.method);
  const detailRows = preview.rows
    .filter((r) => r.state === 'worked' && r.amountCents + r.weightE8 > 0n)
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      positionName: r.positionName ?? '—',
      hoursE2: r.hoursE2 ?? 0n,
      // Solo lo que el método usa (lo mismo que queda en el snapshot al cerrar).
      factor: uses.factor ? (r.factor ?? '') : null,
      individualPoints: uses.points ? r.individualPoints : null,
      weightE8: r.weightE8,
      amountCents: r.amountCents,
      advanceCents: r.advanceAppliedCents,
      finalCents: r.finalCents,
    }));
  const roundingLabel = view.roundingUnit === 'PESO' ? 'pesos enteros' : 'centavos';

  if (phase === 'review') {
    return (
      <ReviewStep
        view={view}
        rows={preview.rows}
        totalCents={preview.totalCents}
        totalAdvanceCents={preview.totalAdvanceCents}
        totalFinalCents={preview.totalFinalCents}
        sectorOnlyCents={preview.sectorOnlyCents}
        canClose={preview.canClose}
        issues={preview.issues.map((i) => i.message)}
        closing={closing}
        error={closeError}
        onBack={() => setPhase('edit')}
        onClose={close}
      >
        {sectorView ? <SectorsCard summary={sectorView} /> : null}
        <CalculationDetail
          rows={detailRows}
          totalCents={preview.totalCents}
          totalWeightE8={preview.totalWeightE8}
          roundingLabel={roundingLabel}
          method={view.method}
          portionDisplay={view.portionDisplay}
          sectors={sectorView}
        />
      </ReviewStep>
    );
  }

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Repartir propinas</h1>
            <Badge variant="warning">Borrador</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Semana del {formatDayMonth(view.weekStart)} al {formatShortDate(view.weekEnd)} · cargá
            la propina y las horas: el resultado se calcula solo.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {view.sectors ? 'Reparto por sectores · ' : ''}Método de participación:{' '}
            {METHOD_LABEL[view.method]} (versión {view.policyVersion} de la configuración).
          </p>
        </div>
        <SaveIndicator state={save} readOnly={readOnly} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {/* ── 1. Propina ── */}
          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleDollarSignIcon className="size-5 text-primary" />
                1. Propina a repartir
              </CardTitle>
              <CardDescription>
                Todo lo que se juntó de propina en la semana (el &quot;pozo&quot;).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tipsMode === 'total' ? (
                <div className="max-w-xs">
                  <label htmlFor="tips-total" className="sr-only">
                    Propina a repartir
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="tips-total"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      className="tabular h-11 pl-7 text-lg"
                      value={totalText}
                      disabled={readOnly}
                      aria-invalid={tipsInvalid || undefined}
                      onChange={(e) => setTotalText(e.target.value)}
                      onBlur={() => void saveTips()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {days.map((date) => (
                    <div key={date}>
                      <label
                        htmlFor={`tips-${date}`}
                        className="mb-1 block text-xs text-muted-foreground capitalize"
                      >
                        {formatWeekday(date)} {formatDayMonth(date)}
                      </label>
                      <Input
                        id={`tips-${date}`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        className="tabular"
                        value={dayTexts[date] ?? ''}
                        disabled={readOnly}
                        onChange={(e) => setDayTexts((v) => ({ ...v, [date]: e.target.value }))}
                        onBlur={() => void saveTips()}
                      />
                    </div>
                  ))}
                </div>
              )}
              {tipsInvalid ? (
                <p role="alert" className="text-sm text-destructive">
                  Revisá el importe: escribilo como 347.990 o 347990.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {tipsMode === 'daily' ? (
                  <span className="tabular font-medium">Total: {formatMoney(tipsCents)}</span>
                ) : null}
                {readOnly ? null : (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center text-primary hover:underline md:min-h-0"
                    onClick={() => {
                      if (tipsMode === 'total') {
                        setTipsMode('daily');
                      } else {
                        setTipsMode('total');
                        // Si se cargaron días, el total pasa a ser su suma; si no, se conserva
                        // el total que ya estaba (ir y volver no borra la propina).
                        if (tipsCents > 0n) setTotalText(moneyInput(tipsCents));
                      }
                    }}
                  >
                    {tipsMode === 'total'
                      ? 'Prefiero cargarla día por día'
                      : 'Cargar solo el total'}
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── 2. Horas ── */}
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <ClockIcon className="size-5 text-primary" />
                2. Horas trabajadas en la semana
              </CardTitle>
              <CardDescription>
                El total de horas de cada persona. Si alguien no trabajó, poné 0. Enter pasa a la
                siguiente; también podés pegar una columna desde Excel.
              </CardDescription>
              {view.people.length >= SEARCH_FROM ? (
                <div className="relative mt-3 max-w-xs">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Buscar persona"
                    placeholder="Buscar persona"
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              ) : null}
            </CardHeader>
            {view.people.length === 0 ? (
              <div className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
                <p>Todavía no hay personal para repartir.</p>
                <Button asChild className="mt-3">
                  <Link href="/personal">
                    <UserPlusIcon />
                    Agregar personal
                  </Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_6.5rem_9rem] gap-3 border-t bg-muted/40 px-6 py-2 text-xs font-medium text-muted-foreground sm:grid">
                  <span>Persona</span>
                  <span className="text-right">Horas</span>
                  <span className="text-right">Le toca</span>
                </div>
                <ul className="divide-y border-t">
                  {visible.map((person) => {
                    const row = rowById.get(person.employeeId);
                    if (!row) return null;
                    return (
                      <HoursRow
                        key={person.employeeId}
                        row={row}
                        showPoints={uses.points}
                        value={hours[person.employeeId] ?? ''}
                        readOnly={readOnly}
                        computed={preview.computed}
                        inputRef={(el) => {
                          inputs.current[person.employeeId] = el;
                        }}
                        onChange={(value) =>
                          setHours((v) => ({ ...v, [person.employeeId]: value }))
                        }
                        onBlur={() => void saveHours([person.employeeId], hours)}
                        onEnter={() => focusNext(person.employeeId)}
                        onPaste={(e) => paste(person.employeeId, e)}
                      />
                    );
                  })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 px-6 py-3 text-sm">
                  <span className="text-muted-foreground">
                    {loaded} de {preview.rows.length} con horas cargadas
                  </span>
                  <span className="tabular font-medium">
                    Total: {formatHoursE2(preview.totalHoursE2)} h
                  </span>
                </div>
                <div className="flex items-center gap-2 border-t px-6 py-3 text-xs text-muted-foreground">
                  <UserPlusIcon className="size-3.5" />
                  ¿Falta alguien?{' '}
                  <Link href="/personal" className="text-primary hover:underline">
                    Agregalo en Personal
                  </Link>{' '}
                  y volvé: lo que cargaste queda guardado.
                </div>
              </>
            )}
          </Card>

          <AdvancesSection view={view} readOnly={readOnly} />
        </div>

        {/* ── Resultado ── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <ResultCard
            preview={preview}
            peopleCount={preview.rows.length}
            sectors={sectorView ? <SectorsCard summary={sectorView} /> : null}
            detail={
              <CalculationDetail
                rows={detailRows}
                totalCents={preview.totalCents}
                totalWeightE8={preview.totalWeightE8}
                roundingLabel={roundingLabel}
                method={view.method}
                portionDisplay={view.portionDisplay}
                sectors={sectorView}
              />
            }
          />
        </div>
      </div>

      {/* ── Barra de acciones ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p
            className={cn(
              'text-sm',
              closeError && !preview.canClose ? 'text-destructive' : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {readOnly
              ? 'Solo lectura: tu rol puede ver el reparto pero no modificarlo.'
              : closeError && !preview.canClose
                ? `Todavía no se puede cerrar: ${closeError}`
                : preview.canClose
                  ? 'Todo cargado. Revisá el resultado y cerrá el reparto.'
                  : missing > 0
                    ? `Faltan las horas de ${missing} ${missing === 1 ? 'persona' : 'personas'}.`
                    : (preview.issues[0]?.message ?? 'Cargá la propina y las horas.')}
          </p>
          {readOnly ? null : (
            <Button onClick={() => void review()} disabled={save.kind === 'saving'}>
              <CheckCircle2Icon />
              Revisar y cerrar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function rowStateOf(text: string): 'missing' | 'invalid' | 'ok' {
  if (text.trim() === '') return 'missing';
  return parseHours(text) === null ? 'invalid' : 'ok';
}

function HoursRow({
  row,
  value,
  readOnly,
  computed,
  inputRef,
  onChange,
  onBlur,
  onEnter,
  onPaste,
  showPoints,
}: {
  row: PreviewRow;
  showPoints: boolean;
  value: string;
  readOnly: boolean;
  computed: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  onEnter: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  const hasAdvance = row.advanceAppliedCents > 0n;
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_9rem] sm:px-6',
        row.state === 'missing' && row.active && 'bg-warning/10',
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{row.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{row.positionName ?? 'Sin puesto'}</span>
          {showPoints && row.individualPoints !== null ? (
            <span className="tabular">· {row.individualPoints} pts</span>
          ) : null}
          {!row.active ? <Badge variant="outline">De baja</Badge> : null}
          {row.state === 'missing' && row.active ? (
            <Badge variant="warning">Sin horas cargadas</Badge>
          ) : null}
          {row.state === 'zero' ? <span>No trabajó</span> : null}
          {row.pendingAdvanceCents > 0n && row.state !== 'worked' ? (
            <span>Adelanto pendiente {formatMoney(row.pendingAdvanceCents)}</span>
          ) : null}
        </p>
      </div>
      <div>
        <div className="relative">
          <Input
            ref={inputRef}
            aria-label={`Horas de ${row.name}`}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="—"
            className={cn(
              'tabular h-10 pr-7 text-right',
              row.state === 'invalid' && 'border-destructive',
            )}
            aria-invalid={row.state === 'invalid' || undefined}
            value={value}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEnter();
              }
            }}
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
            h
          </span>
        </div>
      </div>
      <div className="col-span-2 text-right sm:col-span-1">
        {row.state === 'invalid' ? (
          <p className="text-xs text-destructive">Revisá el número (0 a 168)</p>
        ) : row.state === 'worked' && computed ? (
          <>
            <p className="tabular font-semibold">
              <span className="mr-1 text-xs font-normal text-muted-foreground sm:hidden">
                Le toca
              </span>
              {formatMoney(hasAdvance ? row.finalCents : row.amountCents)}
            </p>
            {hasAdvance ? (
              <p className="tabular text-xs text-muted-foreground">
                {formatMoney(row.amountCents)} − adelanto {formatMoney(row.advanceAppliedCents)}
              </p>
            ) : null}
          </>
        ) : row.state === 'worked' ? (
          <p className="text-xs text-muted-foreground">Falta la propina</p>
        ) : (
          <p className="text-muted-foreground">—</p>
        )}
      </div>
    </li>
  );
}

function SectorsCard({ summary }: { summary: SectorsSummary }) {
  return (
    <Card className="mb-4 gap-3">
      <CardHeader>
        <CardTitle>Reparto por sectores</CardTitle>
        <CardDescription>
          Paso a paso: sobre qué monto se calcula cada porcentaje, cuánto recibe cada sector y
          cuánto queda.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SectorBreakdown summary={summary} />
      </CardContent>
    </Card>
  );
}

function ResultCard({
  preview,
  peopleCount,
  sectors,
  detail,
}: {
  preview: ReturnType<typeof buildPeriodPreview>;
  peopleCount: number;
  sectors: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Resultado</CardTitle>
          <CardDescription>
            {preview.computed
              ? 'Se actualiza mientras cargás. Nada queda definitivo hasta cerrar.'
              : 'Cargá la propina y las horas para ver cuánto le toca a cada persona.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Propina a repartir</span>
            <span className="tabular text-lg font-semibold">{formatMoney(preview.totalCents)}</span>
          </div>
          {preview.totalAdvanceCents > 0n ? (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Adelantos que se descuentan</span>
                <span className="tabular">− {formatMoney(preview.totalAdvanceCents)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <span className="font-medium">A entregar</span>
                <span className="tabular font-semibold">
                  {formatMoney(preview.totalFinalCents)}
                </span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Personas</span>
            <span className="tabular">{peopleCount}</span>
          </div>
          {preview.hourValues.length > 0 ? (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Esta semana, una hora vale{preview.sectors ? ' (en cada sector)' : ''}:
              </p>
              <ul className="space-y-0.5">
                {preview.hourValues.map((h) => (
                  <li key={`${h.positionName}-${h.factor}`} className="flex justify-between gap-2">
                    <span>{h.positionName}</span>
                    <span className="tabular">{formatMoney(h.centsPerHour)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.issues.length > 0 ? (
            <ul className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              {preview.issues.map((i) => (
                <li key={i.code} className="flex gap-2">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-xs text-primary">
              <CheckCircle2Icon className="size-4" />
              Todo cargado: la suma da exacto el total.
            </p>
          )}
        </CardContent>
      </Card>
      {sectors}
      {detail}
    </div>
  );
}

function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) return <Badge variant="outline">Solo lectura</Badge>;
  if (state.kind === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Guardando…
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertTriangleIcon className="size-4" />
        {state.message}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
      <CheckCircle2Icon className="size-4 text-primary" />
      {state.kind === 'saved' ? 'Guardado' : 'Se guarda solo'}
    </span>
  );
}

function ReviewStep({
  view,
  rows,
  totalCents,
  totalAdvanceCents,
  totalFinalCents,
  sectorOnlyCents,
  canClose,
  issues,
  closing,
  error,
  onBack,
  onClose,
  children,
}: {
  view: OpenPeriodView;
  rows: PreviewRow[];
  totalCents: bigint;
  totalAdvanceCents: bigint;
  totalFinalCents: bigint;
  /** Lo de los sectores sin puestos (se entrega al sector, no va en sobres). */
  sectorOnlyCents: bigint;
  canClose: boolean;
  issues: string[];
  closing: boolean;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const worked = rows.filter((r) => r.state === 'worked');
  const zero = rows.filter((r) => r.state === 'zero');
  const hasAdvances = totalAdvanceCents > 0n;
  return (
    <div className="mx-auto max-w-3xl pb-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-primary hover:underline md:mb-4 md:min-h-0"
      >
        <ArrowLeftIcon className="size-4" />
        Volver a editar
      </button>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Revisá el reparto</h1>
          <Badge variant="secondary">Calculado</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Semana del {formatDayMonth(view.weekStart)} al {formatShortDate(view.weekEnd)} ·{' '}
          {formatMoney(totalCents)} entre {worked.length}{' '}
          {worked.length === 1 ? 'persona' : 'personas'}.
        </p>
      </div>

      <Card className="gap-0 py-0">
        <ul className="divide-y">
          {worked.map((r) => (
            <li
              key={r.employeeId}
              className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.positionName} · {formatHoursE2(r.hoursE2 ?? 0n)} h
                </p>
              </div>
              <div className="text-right">
                <p className="tabular font-semibold">{formatMoney(r.finalCents)}</p>
                {r.advanceAppliedCents > 0n ? (
                  <p className="tabular text-xs text-muted-foreground">
                    {formatMoney(r.amountCents)} − adelanto {formatMoney(r.advanceAppliedCents)}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t bg-muted/40 px-4 py-3 text-sm sm:px-6">
          <div className="flex justify-between">
            <span>Propina repartida</span>
            <span className="tabular font-medium">{formatMoney(totalCents)}</span>
          </div>
          {sectorOnlyCents > 0n ? (
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>A sectores sin puestos</span>
              <span className="tabular">− {formatMoney(sectorOnlyCents)}</span>
            </div>
          ) : null}
          {hasAdvances ? (
            <div className="flex justify-between text-muted-foreground">
              <span>Adelantos descontados</span>
              <span className="tabular">− {formatMoney(totalAdvanceCents)}</span>
            </div>
          ) : null}
          {hasAdvances || sectorOnlyCents > 0n ? (
            <div className="flex justify-between font-semibold">
              <span>A entregar en sobres</span>
              <span className="tabular">{formatMoney(totalFinalCents)}</span>
            </div>
          ) : null}
        </div>
      </Card>

      {zero.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No trabajaron esta semana (0 horas, no reciben propina):{' '}
          {zero.map((r) => r.name).join(', ')}.
        </p>
      ) : null}

      <div className="mt-4">{children}</div>

      {issues.length > 0 ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <p className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangleIcon className="size-4" />
            Todavía no se puede cerrar
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" onClick={onBack} disabled={closing}>
          <ArrowLeftIcon />
          Volver a editar
        </Button>
        {view.canClose ? (
          <div className="flex flex-col gap-2 sm:items-end">
            <Button onClick={onClose} disabled={!canClose || closing} size="lg">
              {closing ? <LoaderCircleIcon className="animate-spin" /> : <LockIcon />}
              {closing ? 'Cerrando…' : 'Cerrar reparto'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Al cerrar queda guardado y no se puede modificar.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            El Dueño o el Encargado es quien cierra el reparto.
          </p>
        )}
      </div>
    </div>
  );
}
