'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Gauge, ListChecks, Timer } from 'lucide-react';
import { useAppStore, selectLogsByDay } from '@/store/use-app-store';
import { RatingChip } from '@/components/rating-ui';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { dateKeyOf, formatDuration, friendlyDayLabel, timeOfDay } from '@/lib/format';
import { ratioFor } from '@/lib/rating/suggestRating';
import { cn } from '@/lib/utils';
import type { Log } from '@/types';

const WINDOW_DAYS = 14;
/** Day-groups mounted per page — stats and the trend chart still scan the
 *  full history, but the list itself renders the newest page and pages
 *  back with "Load older" so years of data never mount at once. */
const DAY_PAGE = 30;

export function HistoryView() {
  const logsRecord = useAppStore((s) => s.logs);
  const logsByDay = useMemo(() => selectLogsByDay(logsRecord), [logsRecord]);
  const logs = logsRecord;
  const openRatingSheet = useAppStore((s) => s.openRatingSheet);
  const [showManual, setShowManual] = useState(true);

  const stats = useMemo(() => computeStats(Object.values(logs)), [logs]);

  const chart = useMemo(() => buildChartData(Object.values(logs)), [logs]);

  const filteredDays = useMemo(
    () =>
      logsByDay.map(([key, list]) => [key, list.filter((l) => showManual || l.entryMode !== 'manual')] as [string, Log[]]).filter(
        ([, list]) => list.length > 0
      ),
    [logsByDay, showManual]
  );

  // Windowed day list — keyed on the manual filter so switching it
  // rewinds to the newest page instead of landing mid-history.
  const [dayWindow, setDayWindow] = useState({ key: 'all', pages: 1 });
  const dayWindowKey = showManual ? 'all' : 'tracked';
  const visiblePages = dayWindow.key === dayWindowKey ? dayWindow.pages : 1;
  const visibleDays = useMemo(
    () => filteredDays.slice(0, visiblePages * DAY_PAGE),
    [filteredDays, visiblePages]
  );
  const hiddenDayCount = filteredDays.length - visibleDays.length;

  return (
    <div className="px-4 pt-5" data-testid="history-view">
      <header className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reflect</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">History & trends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Planned vs actual, over the last {WINDOW_DAYS} days and beyond.
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard
          icon={Gauge}
          label="On plan"
          value={stats.onPlanPct == null ? '—' : `${stats.onPlanPct}%`}
          hint="sessions within the estimate"
          testid="stat-onplan"
        />
        <StatCard
          icon={Flame}
          label="Avg overrun"
          value={stats.avgRatio == null ? '—' : `${stats.avgRatio.toFixed(2)}×`}
          hint="actual ÷ expected"
          testid="stat-avgratio"
        />
        <StatCard
          icon={Timer}
          label="Tracked"
          value={formatDuration(stats.totalSeconds)}
          hint="across all sessions"
          testid="stat-tracked"
        />
        <StatCard
          icon={ListChecks}
          label="Sessions"
          value={String(stats.sessionCount)}
          hint={`${stats.manualCount} logged manually`}
          testid="stat-sessions"
        />
      </div>

      {/* Rating distribution */}
      <div className="mt-3 flex items-center gap-2">
        {(['excellent', 'bad', 'lazy'] as const).map((r) => (
          <div
            key={r}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border bg-card py-2 text-sm"
          >
            <RatingChip rating={r} />
            <span className="font-semibold tabular-nums" data-testid={`rating-count-${r}`}>
              {stats.ratingCounts[r]}
            </span>
          </div>
        ))}
      </div>

      {/* Expected vs actual chart */}
      <div className="mt-4 rounded-2xl border bg-card p-4" data-testid="trend-chart">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Expected vs actual</h2>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-muted-foreground/40" aria-hidden /> planned
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-primary" aria-hidden /> actual
            </span>
          </div>
        </div>
        <TrendChart data={chart} />
      </div>

      {/* Manual filter */}
      <div className="mt-4 flex items-center justify-between rounded-xl border bg-card px-3.5 py-2.5">
        <Label htmlFor="show-manual" className="text-sm">
          Include manual entries
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            (backfilled times are less precise)
          </span>
        </Label>
        <Switch id="show-manual" checked={showManual} onCheckedChange={setShowManual} data-testid="show-manual-switch" />
      </div>

      {/* Day groups */}
      <div className="mt-4 flex flex-col gap-4 pb-4">
        {filteredDays.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No sessions recorded yet — run a timer to start your history.
          </p>
        )}
        {visibleDays.map(([dayKey, list]) => (
          <section key={dayKey} aria-label={friendlyDayLabel(dayKey)}>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">{friendlyDayLabel(dayKey)}</h2>
              <span className="text-xs text-muted-foreground">
                {formatDuration(list.reduce((a, l) => a + (l.actualDurationSeconds ?? 0), 0))} tracked
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {list.map((log) => (
                <LogRow key={log.id} log={log} onRate={() => openRatingSheet(log.id)} />
              ))}
            </div>
          </section>
        ))}
        {hiddenDayCount > 0 && (
          <button
            type="button"
            onClick={() => setDayWindow({ key: dayWindowKey, pages: visiblePages + 1 })}
            data-testid="history-load-more"
            className="mt-1 rounded-xl border border-dashed py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Load older sessions
            <span className="ml-1.5 text-xs font-normal tabular-nums">
              {hiddenDayCount} more day{hiddenDayCount === 1 ? '' : 's'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  testid,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  hint: string;
  testid?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-3.5" data-testid={testid}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function computeStats(all: Log[]) {
  const rated = all.filter((l) => l.rating != null);
  const completed = all.filter((l) => l.status === 'completed' && l.actualDurationSeconds != null);
  const withExpectation = completed.filter((l) => l.expectedMinutes > 0);
  const onPlan = withExpectation.filter((l) => (ratioFor(l.actualDurationSeconds, l.expectedMinutes) ?? 0) <= 1);
  const avgRatio =
    withExpectation.length > 0
      ? withExpectation.reduce((a, l) => a + (ratioFor(l.actualDurationSeconds, l.expectedMinutes) ?? 0), 0) /
        withExpectation.length
      : null;
  return {
    onPlanPct: withExpectation.length > 0 ? Math.round((onPlan.length / withExpectation.length) * 100) : null,
    avgRatio,
    totalSeconds: completed.reduce((a, l) => a + (l.actualDurationSeconds ?? 0), 0),
    sessionCount: all.filter((l) => l.status !== 'running').length,
    manualCount: all.filter((l) => l.entryMode === 'manual').length,
    ratingCounts: {
      excellent: rated.filter((l) => l.rating === 'excellent').length,
      bad: rated.filter((l) => l.rating === 'bad').length,
      lazy: rated.filter((l) => l.rating === 'lazy').length,
    },
  };
}

interface DayBar {
  key: string;
  label: string;
  plannedSec: number;
  actualSec: number;
}

function buildChartData(all: Log[]): DayBar[] {
  const byDay = new Map<string, { plannedSec: number; actualSec: number }>();
  const cutoff = dateKeyOf(new Date(Date.now() - (WINDOW_DAYS - 1) * 86_400_000));
  for (const l of all) {
    if (l.dateKey < cutoff) continue;
    const entry = byDay.get(l.dateKey) ?? { plannedSec: 0, actualSec: 0 };
    if (l.status === 'completed' && l.actualDurationSeconds != null) {
      entry.plannedSec += l.expectedMinutes * 60;
      entry.actualSec += l.actualDurationSeconds;
    }
    byDay.set(l.dateKey, entry);
  }
  const days: DayBar[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const key = dateKeyOf(new Date(Date.now() - i * 86_400_000));
    const entry = byDay.get(key) ?? { plannedSec: 0, actualSec: 0 };
    days.push({ key, label: key.slice(8), plannedSec: entry.plannedSec, actualSec: entry.actualSec });
  }
  return days;
}

function TrendChart({ data }: { data: DayBar[] }) {
  const W = 340;
  const H = 132;
  const pad = { top: 8, bottom: 18, left: 4, right: 4 };
  const maxSec = Math.max(3600, ...data.flatMap((d) => [d.plannedSec, d.actualSec]));
  const chartH = H - pad.top - pad.bottom;
  const slot = (W - pad.left - pad.right) / data.length;
  const barW = Math.min(9, slot / 2 - 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 w-full"
      role="img"
      aria-label="Bar chart comparing planned and actual tracked time per day"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={pad.left}
          x2={W - pad.right}
          y1={pad.top + chartH * f}
          y2={pad.top + chartH * f}
          className="stroke-border"
          strokeDasharray="3 4"
          strokeWidth={1}
        />
      ))}
      {data.map((d, i) => {
        const x = pad.left + i * slot + slot / 2;
        const plannedH = d.plannedSec > 0 ? (d.plannedSec / maxSec) * chartH : 0;
        const actualH = d.actualSec > 0 ? (d.actualSec / maxSec) * chartH : 0;
        const over = d.actualSec > d.plannedSec && d.plannedSec > 0;
        return (
          <g key={d.key}>
            {d.plannedSec > 0 && (
              <rect
                x={x - barW - 1.5}
                y={pad.top + chartH - plannedH}
                width={barW}
                height={plannedH}
                rx={2}
                className="fill-muted-foreground/35"
              />
            )}
            {d.actualSec > 0 && (
              <motion.rect
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                x={x + 1.5}
                y={pad.top + chartH - actualH}
                width={barW}
                height={actualH}
                rx={2}
                className={over ? 'fill-amber-500' : 'fill-primary'}
              />
            )}
            {i % 2 === WINDOW_DAYS % 2 && (
              <text x={x} y={H - 5} textAnchor="middle" className="fill-muted-foreground" fontSize={8.5}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LogRow({ log, onRate }: { log: Log; onRate: () => void }) {
  const ratio = ratioFor(log.actualDurationSeconds, log.expectedMinutes);
  const abandonedSkip = log.status === 'abandoned' && log.startedAt == null;
  const over = ratio != null && ratio > 1;

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5" data-testid="history-log-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{log.taskTitle}</p>
          {log.entryMode === 'manual' && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              manual
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {log.startedAt && !abandonedSkip && <>{timeOfDay(log.startedAt)} · </>}
          {abandonedSkip ? (
            'never started'
          ) : log.actualDurationSeconds != null ? (
            <>
              {formatDuration(log.expectedMinutes * 60)} planned ·{' '}
              <span className={cn('font-medium', over ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                {formatDuration(log.actualDurationSeconds)} actual{ratio != null && ` (${ratio.toFixed(2)}×)`}
              </span>
            </>
          ) : (
            'in progress'
          )}
        </p>
      </div>
      {log.rating ? (
        <RatingChip rating={log.rating} />
      ) : log.status !== 'running' ? (
        <button
          onClick={onRate}
          className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
        >
          Rate
        </button>
      ) : null}
    </div>
  );
}
