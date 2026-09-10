'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useAppStore } from '@/store/use-app-store';
import { LogRow } from '@/components/log-row';
import { friendlyDayLabel, formatDuration, parseDayKey, planDayLabel } from '@/lib/format';
import { iconMeta, taskColorMeta } from '@/lib/task-style';
import { foldColorDotsByDay } from '@/lib/logs';
import { cn } from '@/lib/utils';
import { CalendarPlus } from 'lucide-react';
import type { Task } from '@/types';

/**
 * Structured's "Overview": month calendar with per-day colored activity
 * dots, plus a detail list for the selected day (sessions, durations,
 * ratings) with tap-through to the rating moment for unrated sessions.
 */
export function OverviewView() {
  const overviewDateKey = useAppStore((s) => s.overviewDateKey);
  const setOverviewDate = useAppStore((s) => s.setOverviewDate);
  const logsRecord = useAppStore((s) => s.logs);
  const tasksRecord = useAppStore((s) => s.tasks);
  const openRatingSheet = useAppStore((s) => s.openRatingSheet);
  const openTaskForm = useAppStore((s) => s.openTaskForm);
  // Day keys are local buckets — parse them as local dates (parseISO would
  // anchor 'yyyy-MM-dd' to UTC midnight and shift the whole calendar a day
  // west of Greenwich).
  const [monthCursor, setMonthCursor] = useState(() =>
    parseDayKey(overviewDateKey || format(new Date(), 'yyyy-MM-dd')),
  );

  const selectedDate = parseDayKey(overviewDateKey || format(new Date(), 'yyyy-MM-dd'));

  // Stable color lookup for dots (denormalized fallback for deleted tasks).
  const colorOfTask = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of Object.values(tasksRecord)) map.set(t.id, taskColorMeta(t.color).hex);
    return (taskId: string) => map.get(taskId) ?? taskColorMeta(null).hex;
  }, [tasksRecord]);

  const daysWithDots = useMemo(
    () =>
      foldColorDotsByDay(Object.values(logsRecord), (taskId) => colorOfTask(taskId)),
    [logsRecord, colorOfTask],
  );

  // Six-week grid covering the visible month.
  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [monthCursor]);

  const dayLogs = useMemo(() => {
    const key = format(selectedDate, 'yyyy-MM-dd');
    return Object.values(logsRecord)
      .filter((l) => l.dateKey === key)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }, [logsRecord, selectedDate]);

  // The plan made for this specific day (planning ahead), soonest first —
  // timed blocks before anytime. Only dated tasks appear here; undated
  // tasks live on Today's timeline every day, not on every calendar day.
  const dayPlan = useMemo(() => {
    const key = format(selectedDate, 'yyyy-MM-dd');
    return Object.values(tasksRecord)
      .filter((t) => !t.archived && t.scheduledDateKey === key)
      .sort((a, b) =>
        `${a.scheduledStart ?? '99:99'}`.localeCompare(`${b.scheduledStart ?? '99:99'}`)
      );
  }, [tasksRecord, selectedDate]);

  const trackedSeconds = dayLogs.reduce((acc, l) => acc + (l.actualDurationSeconds ?? 0), 0);
  const ratedCount = dayLogs.filter((l) => l.rating).length;

  return (
    <div className="px-3 pt-4" data-testid="overview-view">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-1">
        <button
          onClick={() => setMonthCursor((m) => addMonths(m, -1))}
          aria-label="Previous month"
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-[17px] font-bold tracking-tight">{format(monthCursor, 'MMMM yyyy')}</h1>
        <button
          onClick={() => setMonthCursor((m) => addMonths(m, 1))}
          aria-label="Next month"
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Weekday header */}
      <div className="mt-3 grid grid-cols-7 px-0.5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {d[0]}
          </span>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-y-1 px-0.5" role="grid" aria-label={format(monthCursor, 'MMMM yyyy')}>
        {gridDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const selected = isSameDay(day, selectedDate);
          const inMonth = isSameMonth(day, monthCursor);
          const dots = (daysWithDots.get(key) ?? []).slice(0, 3);
          return (
            <button
              key={key}
              onClick={() => setOverviewDate(key)}
              role="gridcell"
              aria-label={format(day, 'EEEE, d MMMM')}
              aria-selected={selected}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors',
                !inMonth && 'opacity-35',
                selected ? 'bg-muted' : 'hover:bg-muted/50'
              )}
            >
              <span
                className={cn(
                  'grid size-8 place-items-center rounded-full text-[13px] font-semibold',
                  selected && 'bg-primary text-primary-foreground',
                  !selected && isToday(day) && 'text-primary',
                  !selected && !isToday(day) && 'text-foreground'
                )}
              >
                {format(day, 'd')}
              </span>
              <span className="flex h-1 items-center gap-[2px]" aria-hidden>
                {dots.map((hex, i) => (
                  <span key={i} className="size-1 rounded-full" style={{ backgroundColor: hex }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      <section className="mt-5" aria-label={`Sessions on ${format(selectedDate, 'd MMMM')}`}>
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm font-bold">{friendlyDayLabel(format(selectedDate, 'yyyy-MM-dd'))}</h2>
          {dayLogs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {formatDuration(trackedSeconds)} tracked · {ratedCount}/{dayLogs.length} rated
            </p>
          )}
        </div>

        {/* Planned for this day — the plan-ahead list (tap a row to edit) */}
        <div className="mb-3" data-testid="day-plan">
          {dayPlan.length > 0 && (
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Planned · {dayPlan.length === 1 ? '1 task' : `${dayPlan.length} tasks`}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {dayPlan.map((task) => (
              <DayPlanRow key={task.id} task={task} />
            ))}
            <li>
              <button
                onClick={() =>
                  openTaskForm(undefined, null, format(selectedDate, 'yyyy-MM-dd'))
                }
                data-testid="day-plan-add"
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <CalendarPlus className="size-4" aria-hidden />
                Add a task for this day
              </button>
            </li>
          </ul>
        </div>

        {dayLogs.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No sessions on this day.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dayLogs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                testidPrefix="overview-log"
                onRate={() => openRatingSheet(log.id)}
                rowClickable
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayPlanRow({ task }: { task: Task }) {
  const openTaskForm = useAppStore((s) => s.openTaskForm);
  const hex = taskColorMeta(task.color).hex;
  const { Icon } = iconMeta(task.icon);

  return (
    <li>
      <button
        onClick={() => openTaskForm(task.id)}
        className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
        data-testid={`day-plan-${task.id}`}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: hex }}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{task.title}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">
            {task.scheduledStart ?? 'Anytime'} ·{' '}
            {formatDuration(task.expectedDurationMinutes * 60)} planned
          </span>
        </span>
        <span
          className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
          aria-hidden
        >
          {planDayLabel(task.scheduledDateKey!)}
        </span>
      </button>
    </li>
  );
}
