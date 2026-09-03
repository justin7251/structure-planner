'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarPlus, ChevronRight, ClockPlus, RefreshCw } from 'lucide-react';
import { format, isToday } from 'date-fns';
import { selectSortedActiveTasks, selectTodayNotes, useAppStore } from '@/store/use-app-store';
import { useAuthStore } from '@/store/use-auth-store';
import { useSyncNow } from '@/hooks/use-sync';
import { cn } from '@/lib/utils';
import { WeekStrip } from '@/components/week-strip';
import { Timeline } from '@/components/timeline';
import { TaskTimelineRowStyle } from '@/components/timeline-row';
import { formatDuration, planDayLabel, tomorrowKey } from '@/lib/format';
import { iconMeta, taskColorMeta } from '@/lib/task-style';
import { NotesSection } from '@/components/notes-section';
import { ExitToLandingButton } from '@/components/exit-to-landing';
import type { Task } from '@/types';

/**
 * Structured-style day view: big date header (tap → month overview),
 * week strip with per-day activity dots, the hour timeline, then
 * unscheduled "Anytime" tasks rendered in the same visual language.
 */
export function TodayView() {
  const tasksRecord = useAppStore((s) => s.tasks);
  const tasks = useMemo(() => selectSortedActiveTasks(tasksRecord), [tasksRecord]);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setOverviewDate = useAppStore((s) => s.setOverviewDate);
  const openTaskForm = useAppStore((s) => s.openTaskForm);
  const openManualTime = useAppStore((s) => s.openManualTime);
  const logsRecord = useAppStore((s) => s.logs);
  const notesRecord = useAppStore((s) => s.notes);
  const sync = useSyncNow();
  const lastSyncAt = useAuthStore((s) => s.lastSyncAt);
  const syncBusy = useAuthStore((s) => s.syncBusy);

  // Sync health dot — re-evaluated every 30s so "fresh" decays to "stale"
  // without any user interaction, and immediately on online/offline flips.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Lazy init from the browser (never runs on the server — the view only
  // mounts after hydration) so the first paint already reflects reality.
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const syncStatus = useMemo((): { color: string; label: string } => {
    if (!online) return { color: 'bg-zinc-400 dark:bg-zinc-500', label: 'Offline — will sync when you reconnect' };
    if (syncBusy) return { color: 'bg-amber-400', label: 'Syncing…' };
    if (!lastSyncAt) return { color: 'bg-amber-400', label: 'Sync due — tap to refresh' };
    const ageMin = (nowMs - new Date(lastSyncAt).getTime()) / 60_000;
    return ageMin < 5
      ? { color: 'bg-emerald-500', label: `Up to date — last sync ${format(new Date(lastSyncAt), 'HH:mm')}` }
      : { color: 'bg-amber-400', label: `Last sync ${format(new Date(lastSyncAt), 'HH:mm')} — tap to refresh` };
  }, [online, syncBusy, lastSyncAt, nowMs]);

  const now = new Date();
  const todayKeyStr = format(now, 'yyyy-MM-dd');

  // Today's plan: undated tasks (legacy "any day") + tasks planned for today.
  // Plain filters — the lists are small and memoization here trips the
  // React-compiler lint (todayKeyStr is fresh every render).
  const todayTasks = tasks.filter((t) => !t.scheduledDateKey || t.scheduledDateKey === todayKeyStr);
  // Everything planned for a later day, soonest first (anytime after timed).
  const upcoming = tasks
    .filter((t) => t.scheduledDateKey && t.scheduledDateKey > todayKeyStr)
    .sort((a, b) =>
      `${a.scheduledDateKey}:${a.scheduledStart ?? '99:99'}`.localeCompare(
        `${b.scheduledDateKey}:${b.scheduledStart ?? '99:99'}`
      )
    );

  const anytime = todayTasks.filter((t) => !t.scheduledStart);
  const todayNotes = useMemo(() => selectTodayNotes(notesRecord), [notesRecord]);

  const plannedMinutes = todayTasks.reduce((acc, t) => acc + t.expectedDurationMinutes, 0);
  const todayLogs = Object.values(logsRecord).filter((l) => l.dateKey === todayKeyStr);
  const trackedSeconds = todayLogs.reduce((acc, l) => acc + (l.actualDurationSeconds ?? 0), 0);

  const goOverview = (key?: string) => {
    if (key) setOverviewDate(key);
    setActiveTab('overview');
  };

  return (
    <div className="px-3 pt-4" data-testid="today-view">
      {/* Sticky header — date, week strip and summary stay put like Structured */}
      <div className="sticky top-0 z-20 -mx-3 bg-background px-3 pb-2 pt-4">
      {/* Date header */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => goOverview(todayKeyStr)}
          className="flex min-w-0 flex-1 items-baseline gap-1 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/40"
          aria-label="Open month overview"
          data-testid="open-overview"
        >
          <h1 className="truncate text-[22px] font-bold tracking-tight">
            {isToday(now) ? 'Today' : format(now, 'EEEE')}
            <span className="text-muted-foreground"> · </span>
            {/* Short month — leaves room for the header buttons on phones */}
            {format(now, 'd MMM yyyy')}
          </h1>
          <ChevronRight className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden />
        </button>
        {/* Manual cloud refresh — phones suspend background tabs and sync
            doesn't always resume on its own (signed-in users only). The
            dot shows sync health at a glance. */}
        {sync.canSync && (
          <button
            type="button"
            onClick={() => void sync.run()}
            disabled={sync.busy}
            aria-label={`Sync now — ${syncStatus.label}`}
            title={syncStatus.label}
            data-testid="today-sync"
            className="relative grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-60"
          >
            <RefreshCw
              className={`size-[18px]${sync.busy ? ' animate-spin' : ''}`}
              aria-hidden
            />
            <span
              aria-hidden
              data-testid="sync-status-dot"
              className={cn(
                'absolute bottom-1 right-1 size-2 rounded-full ring-2 ring-background',
                syncStatus.color
              )}
            />
          </button>
        )}
        {/* The way back to the landing page — visible from the first screen */}
        <ExitToLandingButton variant="icon" testid="today-exit" />
      </div>

      {/* Week strip */}
      <div className="mt-2">
        <WeekStrip selectedKey={todayKeyStr} onSelect={(key) => key !== todayKeyStr && goOverview(key)} />
      </div>

      {/* Day summary — kept from the core loop */}
      {tasks.length > 0 && (
        <p className="mb-1 mt-2 px-1 text-xs text-muted-foreground" data-testid="day-summary">
          <span className="font-semibold text-foreground">{formatDuration(trackedSeconds)}</span> tracked
          {plannedMinutes > 0 && <> of {formatDuration(plannedMinutes * 60)} planned</>}
          {' · '}
          <span className="font-semibold text-foreground">{todayLogs.filter((l) => l.rating).length}</span> rated today
        </p>
      )}
      </div>

      {/* Timeline */}
      <div className="mt-2 overflow-hidden rounded-2xl border bg-card/40">
        {todayTasks.length === 0 ? (
          <EmptyPlan onAdd={() => openTaskForm()} />
        ) : (
          <Timeline />
        )}
      </div>

      {/* Anytime (unscheduled) tasks */}
      {anytime.length > 0 && (
        <section className="mt-5" aria-label="Anytime tasks">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Anytime
          </h2>
          <ul className="flex flex-col gap-2">
            {anytime.map((task, i) => (
              <li key={task.id}>
                <TaskTimelineRowStyle task={task} index={i} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Coming up — plans made for later days (plan ahead) */}
      <section className="mt-5" aria-label="Coming up" data-testid="coming-up">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Coming up{upcoming.length > 5 ? ` (${upcoming.length})` : ''}
        </h2>
        <ul className="flex flex-col gap-2">
          {upcoming.slice(0, 5).map((task) => (
            <UpcomingRow key={task.id} task={task} />
          ))}
          <li>
            <button
              onClick={() => openTaskForm(undefined, null, tomorrowKey())}
              data-testid="plan-ahead-btn"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <CalendarPlus className="size-4" aria-hidden />
              Plan for a future day
            </button>
          </li>
        </ul>
      </section>

      {/* Notes captured with the Note Taker */}
      <NotesSection notes={todayNotes} />

      {todayTasks.length > 0 && (
        <button
          onClick={() => openManualTime()}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          data-testid="add-time-inline"
        >
          <ClockPlus className="size-4" aria-hidden />
          Forgot the timer? Log past time
        </button>
      )}

      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        Timers survive refreshes, tab switches, and app kills — elapsed time is always derived from the
        start timestamp, never a counter.
      </p>
    </div>
  );
}

/** A plan made for a later day — tap to edit it (form shows its day). */
function UpcomingRow({ task }: { task: Task }) {
  const openTaskForm = useAppStore((s) => s.openTaskForm);
  const meta = taskColorMeta(task.color);
  const { Icon } = iconMeta(task.icon);

  return (
    <li>
      <button
        onClick={() => openTaskForm(task.id)}
        className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 active:scale-[0.99]"
        data-testid={`upcoming-${task.id}`}
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundColor: meta.hex }}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{task.title}</span>
          <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
            {planDayLabel(task.scheduledDateKey!)} · {task.scheduledStart ?? 'anytime'} ·{' '}
            {formatDuration(task.expectedDurationMinutes * 60)}
          </span>
          {task.detail && (
            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted-foreground/80">
              {task.detail}
            </span>
          )}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

function EmptyPlan({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <CalendarPlus className="size-6 text-primary" aria-hidden />
      </div>
      <div>
        <p className="font-semibold">Nothing planned yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a task with an expected duration — honest estimates are how the app teaches you to plan.
        </p>
      </div>
      <button
        onClick={onAdd}
        className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        data-testid="empty-add-task"
      >
        <CalendarPlus className="size-4" aria-hidden />
        Plan your first task
      </button>
    </motion.div>
  );
}
