'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  addDays,
  addWeeks,
  differenceInCalendarWeeks,
  format,
  isToday,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { useAppStore } from '@/store/use-app-store';
import { LogRow } from '@/components/log-row';
import { NoteCard } from '@/components/note-card';
import { dateKeyOf, formatDuration, friendlyDayLabel, parseDayKey, todayKey } from '@/lib/format';
import { ratioFor } from '@/lib/rating/suggestRating';
import { taskColorMeta } from '@/lib/task-style';
import { foldColorDotsByDay } from '@/lib/logs';
import { cn } from '@/lib/utils';
import type { Log, Note } from '@/types';

/**
 * Weekly review — the wide-screen (iPad/desktop) dashboard.
 *
 * Left: the week at a glance — four stat cards with vs-last-week delta
 * chips, a six-week tracked-time sparkline, a seven-day progress grid
 * (columns on md+, stacked rows on phones) and the selected day's sessions.
 * Right (lg+): the notes review panel — captured notes grouped by day
 * (rendered as a window of recent days with a Load-older pager, so three
 * years of notes never mount at once) with search and an All / Week / Day
 * scope (Day follows the selected day in the grid), plus each linked
 * task's outcome, so a weekly review is one scroll instead of seven
 * day-visits.
 */

interface DayProgress {
  key: string;
  label: string; // "Mon"
  dayNum: string; // "1"
  sessions: number; // attempts that reached a terminal status
  done: number;
  skipped: number;
  trackedSec: number;
  plannedSec: number;
  colors: string[]; // unique task colors, for dots
}

// ── Scale guards ───────────────────────────────────────────────────
// Years of daily use add up: thousands of notes can never be mounted at
// once without freezing the panel. Notes render a window of recent
// day-groups that pages back with "Load older", and search results are
// hard-capped with a refine hint instead of an unbounded match list.
const NOTE_GROUP_WINDOW = 15;
const NOTE_SEARCH_CAP = 200;

export function WeekView() {
  const logsRecord = useAppStore((s) => s.logs);
  const notesRecord = useAppStore((s) => s.notes);
  const tasksRecord = useAppStore((s) => s.tasks);
  const openRatingSheet = useAppStore((s) => s.openRatingSheet);
  const deleteNote = useAppStore((s) => s.deleteNote);

  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState(() => todayKey());
  const [notesQuery, setNotesQuery] = useState('');
  const [notesScope, setNotesScope] = useState<'all' | 'week' | 'day'>('all');

  const weekStart = useMemo(
    () => startOfWeek(weekAnchor, { weekStartsOn: 1 }),
    [weekAnchor]
  );
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekKeys = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < 7; i++) set.add(dateKeyOf(addDays(weekStart, i)));
    return set;
  }, [weekStart]);

  const isCurrentWeek = dateKeyOf(weekStart) === dateKeyOf(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const rangeLabel =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${format(weekStart, 'd')}–${format(weekEnd, 'd')} ${format(weekEnd, 'MMM yyyy')}`
      : `${format(weekStart, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`;

  // ── Per-day progress from logs ─────────────────────────────────
  // Logs are the ground truth for the past: every attempt (done or
  // skipped) is a log row, so done/skipped/time all come from there.
  const days = useMemo<DayProgress[]>(() => {
    const all = Object.values(logsRecord);
    // Unique task colors per day — the shared activity-dots fold.
    const dots = foldColorDotsByDay(
      all.filter((l) => l.status !== 'running'),
      (taskId) => taskColorMeta(tasksRecord[taskId]?.color).hex,
    );
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const key = dateKeyOf(date);
      const dayLogs = all.filter((l) => l.dateKey === key && l.status !== 'running');
      const done = dayLogs.filter((l) => l.status === 'completed').length;
      return {
        key,
        label: format(date, 'EEE'),
        dayNum: format(date, 'd'),
        sessions: dayLogs.length,
        done,
        skipped: dayLogs.length - done,
        trackedSec: dayLogs.reduce((a, l) => a + (l.actualDurationSeconds ?? 0), 0),
        plannedSec: dayLogs.reduce((a, l) => a + l.expectedMinutes * 60, 0),
        colors: dots.get(key) ?? [],
      };
    });
  }, [logsRecord, tasksRecord, weekStart]);

  const totals = useMemo(() => {
    const done = days.reduce((a, d) => a + d.done, 0);
    const sessions = days.reduce((a, d) => a + d.sessions, 0);
    const trackedSec = days.reduce((a, d) => a + d.trackedSec, 0);
    const plannedSec = days.reduce((a, d) => a + d.plannedSec, 0);
    const activeDays = days.filter((d) => d.done > 0).length;
    const completedLogs = Object.values(logsRecord).filter(
      (l) => l.status === 'completed' && l.expectedMinutes > 0 && weekKeys.has(l.dateKey)
    );
    const onPlan = completedLogs.filter(
      (l) => (ratioFor(l.actualDurationSeconds, l.expectedMinutes) ?? 0) <= 1
    ).length;
    return {
      done,
      sessions,
      trackedSec,
      plannedSec,
      activeDays,
      onPlanPct: completedLogs.length > 0 ? Math.round((onPlan / completedLogs.length) * 100) : null,
    };
  }, [days, logsRecord, weekKeys]);

  // ── Week-over-week context (deltas + sparkline) ────────────────
  // One pass over the logs, bucketed into the five weeks before the
  // visible one (index -5…-1; the visible week itself comes from `days`).
  const prevWeeks = useMemo(() => {
    const empty = () => ({ done: 0, sessions: 0, trackedSec: 0, plannedSec: 0, onPlanN: 0, onPlanHit: 0 });
    const map = new Map<number, ReturnType<typeof empty>>();
    for (let k = -5; k <= -1; k++) map.set(k, empty());
    for (const l of Object.values(logsRecord)) {
      if (l.status === 'running') continue;
      const k = differenceInCalendarWeeks(parseDayKey(l.dateKey), weekStart, { weekStartsOn: 1 });
      if (k < -5 || k > -1) continue;
      const b = map.get(k)!;
      b.sessions++;
      b.plannedSec += l.expectedMinutes * 60;
      if (l.status === 'completed') {
        b.done++;
        b.trackedSec += l.actualDurationSeconds ?? 0;
        if (l.expectedMinutes > 0) {
          b.onPlanN++;
          if ((ratioFor(l.actualDurationSeconds, l.expectedMinutes) ?? 0) <= 1) b.onPlanHit++;
        }
      }
    }
    return map;
  }, [logsRecord, weekStart]);

  const trend = useMemo(() => {
    const items: number[] = [];
    for (let k = -5; k <= -1; k++) items.push(prevWeeks.get(k)!.trackedSec);
    items.push(totals.trackedSec);
    return items;
  }, [prevWeeks, totals]);

  const prev = prevWeeks.get(-1)!;
  const prevOnPlanPct = prev.onPlanN > 0 ? Math.round((prev.onPlanHit / prev.onPlanN) * 100) : null;

  // "Vs last week" chips. Tone: more done/tracked and higher on-plan rate
  // are good; planned time is neutral (planning more isn't success or
  // failure). Chips are hidden entirely when neither week has data.
  const doneDiff = totals.done - prev.done;
  const doneDelta =
    prev.sessions === 0 && totals.sessions === 0 ? null : (
      <DeltaChip
        text={`${doneDiff > 0 ? '+' : doneDiff < 0 ? '−' : '±'}${doneDiff === 0 ? '0' : Math.abs(doneDiff)}`}
        tone={doneDiff > 0 ? 'good' : doneDiff < 0 ? 'bad' : 'neutral'}
      />
    );

  const trackedDiff = totals.trackedSec - prev.trackedSec;
  const trackedDelta =
    prev.trackedSec === 0 && totals.trackedSec === 0 ? null : (
      <DeltaChip
        text={`${trackedDiff > 0 ? '+' : trackedDiff < 0 ? '−' : '±'}${formatDuration(Math.abs(trackedDiff))}`}
        tone={trackedDiff > 0 ? 'good' : trackedDiff < 0 ? 'bad' : 'neutral'}
      />
    );

  const plannedDiff = totals.plannedSec - prev.plannedSec;
  const plannedDelta =
    prev.plannedSec === 0 && totals.plannedSec === 0 ? null : (
      <DeltaChip
        text={`${plannedDiff > 0 ? '+' : plannedDiff < 0 ? '−' : '±'}${formatDuration(Math.abs(plannedDiff))}`}
        tone="neutral"
      />
    );

  const onPlanDiff = totals.onPlanPct != null && prevOnPlanPct != null ? totals.onPlanPct - prevOnPlanPct : null;
  const onPlanDelta =
    onPlanDiff == null
      ? null
      : onPlanDiff === 0 ? (
          <DeltaChip text="±0 pts" tone="neutral" />
        ) : (
          <DeltaChip
            text={`${onPlanDiff > 0 ? '+' : '−'}${Math.abs(onPlanDiff)} pts`}
            tone={onPlanDiff > 0 ? 'good' : 'bad'}
          />
        );

  // ── Selected day detail ────────────────────────────────────────
  const detailLogs = useMemo(() => {
    if (!weekKeys.has(selectedKey)) return [];
    return Object.values(logsRecord)
      .filter((l) => l.dateKey === selectedKey && l.status !== 'running')
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }, [logsRecord, selectedKey, weekKeys]);

  // ── Notes review ───────────────────────────────────────────────
  // Linked notes carry the task + its day; the lookup answers "did the
  // thing this note is about actually get done?"
  const logsByTaskDay = useMemo(() => {
    const map = new Map<string, Log[]>();
    for (const l of Object.values(logsRecord)) {
      if (l.status === 'running') continue;
      const k = `${l.taskId}|${l.dateKey}`;
      const list = map.get(k) ?? [];
      list.push(l);
      map.set(k, list);
    }
    return map;
  }, [logsRecord]);

  const noteGroups = useMemo(() => {
    const q = notesQuery.trim().toLowerCase();
    const filtered = Object.values(notesRecord)
      .filter((n) =>
        notesScope === 'week' ? weekKeys.has(n.dateKey) : notesScope === 'day' ? n.dateKey === selectedKey : true
      )
      .filter(
        (n) =>
          q === '' ||
          n.text.toLowerCase().includes(q) ||
          (n.taskTitle ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const groups = new Map<string, Note[]>();
    for (const n of filtered) {
      const list = groups.get(n.dateKey) ?? [];
      list.push(n);
      groups.set(n.dateKey, list);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [notesRecord, notesQuery, notesScope, weekKeys, selectedKey]);

  const totalNotesShown = noteGroups.reduce((a, [, list]) => a + list.length, 0);
  const allNotesCount = Object.keys(notesRecord).length;

  // Windowed rendering — newest day-groups first, "Load older" pages
  // back through the rest. The window resets whenever the scope or the
  // query changes (keyed state, so typing doesn't churn effects).
  const isSearching = notesQuery.trim().length > 0;
  const [noteWindow, setNoteWindow] = useState({ key: '', count: NOTE_GROUP_WINDOW });
  const notesWindowKey = `${notesScope}|${notesQuery.trim().toLowerCase()}`;
  const visibleGroupCount = noteWindow.key === notesWindowKey ? noteWindow.count : NOTE_GROUP_WINDOW;

  const renderedGroups = useMemo<Array<[string, Note[]]>>(() => {
    if (!isSearching) return noteGroups.slice(0, visibleGroupCount);
    // Searches stay usable on huge datasets: cap the mounted matches
    // and point at refining instead of rendering thousands of rows.
    let remaining = NOTE_SEARCH_CAP;
    const capped: Array<[string, Note[]]> = [];
    for (const group of noteGroups) {
      if (remaining <= 0) break;
      const take = group[1].slice(0, remaining);
      remaining -= take.length;
      capped.push([group[0], take]);
    }
    return capped;
  }, [noteGroups, isSearching, visibleGroupCount]);

  const renderedNoteCount = renderedGroups.reduce((a, [, list]) => a + list.length, 0);
  const hiddenGroupCount = isSearching ? 0 : noteGroups.length - renderedGroups.length;
  const searchCapped = isSearching && totalNotesShown > NOTE_SEARCH_CAP;
  const loadOlderNotes = () =>
    setNoteWindow({ key: notesWindowKey, count: visibleGroupCount + NOTE_GROUP_WINDOW });

  const navigateWeek = (dir: 1 | -1) => {
    const next = addWeeks(weekAnchor, dir);
    const nextStart = startOfWeek(next, { weekStartsOn: 1 });
    const nextKeys = new Set<string>();
    for (let i = 0; i < 7; i++) nextKeys.add(dateKeyOf(addDays(nextStart, i)));
    // Keep the selection when it stays inside the visible week; otherwise
    // snap to today (when present) or the week's first day.
    if (!nextKeys.has(selectedKey)) {
      setSelectedKey(nextKeys.has(todayKey()) ? todayKey() : dateKeyOf(nextStart));
    }
    setWeekAnchor(next);
  };

  const goCurrentWeek = () => {
    setWeekAnchor(new Date());
    setSelectedKey(todayKey());
  };

  return (
    <div className="px-3 pt-4 md:px-6 md:pt-5" data-testid="week-view">
      {/* Header + week navigation */}
      <header className="md:flex md:items-end md:justify-between md:gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Review</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">Weekly progress</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rangeLabel} · {totals.activeDays === 1 ? '1 active day' : `${totals.activeDays} active days`} ·{' '}
            {formatDuration(totals.trackedSec)} tracked
          </p>
        </div>
        <div className="mt-3 flex items-center gap-1.5 md:mt-0" data-testid="week-nav">
          <button
            onClick={() => navigateWeek(-1)}
            aria-label="Previous week"
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <ChevronLeft className="size-5" />
          </button>
          {!isCurrentWeek && (
            <button
              onClick={goCurrentWeek}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/60"
            >
              This week
            </button>
          )}
          <button
            onClick={() => navigateWeek(1)}
            aria-label="Next week"
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </header>

      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* ── Left: week at a glance ─────────────────────────────── */}
        <div className="min-w-0">
          {/* Stat cards — each with a vs-last-week delta where one exists */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <StatCard
              label="Done"
              value={`${totals.done}/${totals.sessions}`}
              hint={totals.sessions - totals.done > 0 ? `${totals.sessions - totals.done} not completed` : 'all sessions done'}
              testid="week-stat-done"
              delta={doneDelta}
            />
            <StatCard
              label="Tracked"
              value={formatDuration(totals.trackedSec)}
              hint="actual time recorded"
              testid="week-stat-tracked"
              delta={trackedDelta}
            />
            <StatCard
              label="Planned"
              value={formatDuration(totals.plannedSec)}
              hint="time you scheduled"
              testid="week-stat-planned"
              delta={plannedDelta}
            />
            <StatCard
              label="On plan"
              value={totals.onPlanPct == null ? '—' : `${totals.onPlanPct}%`}
              hint="sessions within estimate"
              testid="week-stat-onplan"
              delta={onPlanDelta}
            />
          </div>

          {/* Six-week trend sparkline (visible week = last bar) */}
          <div className="mt-2.5 rounded-2xl border bg-card px-4 py-3" data-testid="week-trend">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium text-muted-foreground">Tracked · last 6 weeks</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">{formatDuration(totals.trackedSec)} this week</p>
            </div>
            <div className="mt-2 flex items-end gap-1.5">
              {trend.map((sec, i) => {
                const last = i === trend.length - 1;
                // Bar i holds the week (i - (len-1)) relative to the visible
                // week: 5 bars back, then the visible week as the last bar.
                const weekStartI = addDays(weekStart, 7 * (i - (trend.length - 1)));
                const maxSec = Math.max(...trend);
                const h = maxSec > 0 && sec > 0 ? Math.max(8, (sec / maxSec) * 100) : 5;
                return (
                  <div
                    key={i}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1"
                    title={`${formatDuration(sec)} · week of ${format(weekStartI, 'd MMM')}`}
                    data-testid={`week-trend-bar-${i}`}
                  >
                    <div className="flex h-10 w-full items-end">
                      <div
                        className={cn(
                          'w-full rounded-t-sm transition-[height]',
                          last ? 'bg-primary' : sec > 0 ? 'bg-muted-foreground/30' : 'bg-muted'
                        )}
                        style={{ height: `${h}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-[9.5px] tabular-nums',
                        last ? 'font-bold text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {format(weekStartI, 'd')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Seven-day progress grid — columns on md+, rows on phones */}
          <div
            className="mt-4 grid grid-cols-1 gap-1.5 md:grid-cols-7"
            role="group"
            aria-label="Progress per day"
            data-testid="week-day-grid"
          >
            {days.map((d) => (
              <DayCell
                key={d.key}
                day={d}
                selected={d.key === selectedKey}
                onSelect={() => {
                  setSelectedKey(d.key);
                  // The review link: picking a day scopes the notes panel to it.
                  setNotesScope('day');
                }}
              />
            ))}
          </div>

          {/* Selected day detail */}
          <section className="mt-5" aria-label={`Sessions on ${friendlyDayLabel(selectedKey)}`} data-testid="week-day-detail">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-bold">{friendlyDayLabel(selectedKey)}</h2>
              {detailLogs.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {detailLogs.filter((l) => l.status === 'completed').length}/{detailLogs.length} done ·{' '}
                  {formatDuration(detailLogs.reduce((a, l) => a + (l.actualDurationSeconds ?? 0), 0))}
                </p>
              )}
            </div>
            {detailLogs.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No sessions recorded on this day.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {detailLogs.map((log, i) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    testidPrefix="week-session"
                    onRate={() => openRatingSheet(log.id)}
                    animated
                    index={i}
                    showPlanRatio
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right: notes review (sticky column on lg+) ─────────── */}
        <aside
          className="mt-6 lg:sticky lg:top-4 lg:mt-0 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1"
          aria-label="Notes review"
          data-testid="notes-review"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-bold">Notes review</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {renderedNoteCount === allNotesCount ? `${allNotesCount}` : `${renderedNoteCount} of ${allNotesCount}`}
            </span>
          </div>

          {/* Search + scope */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={notesQuery}
                onChange={(e) => setNotesQuery(e.target.value)}
                placeholder="Search notes…"
                aria-label="Search notes"
                data-testid="notes-search"
                className="h-9 w-full rounded-lg border bg-card pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>
            <div className="flex shrink-0 rounded-lg border p-0.5" role="group" aria-label="Notes scope">
              {(['all', 'week'] as const).map((scope) => (
                <button
                  key={scope}
                  onClick={() => setNotesScope(scope)}
                  aria-pressed={notesScope === scope}
                  data-testid={`notes-scope-${scope}`}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                    notesScope === scope ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {scope === 'all' ? 'All' : 'Week'}
                </button>
              ))}
              <button
                onClick={() => setNotesScope('day')}
                aria-pressed={notesScope === 'day'}
                title={`Notes from ${friendlyDayLabel(selectedKey)} — follows the selected day`}
                data-testid="notes-scope-day"
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  notesScope === 'day' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Day
              </button>
            </div>
          </div>

          {/* Grouped notes, newest first */}
          <div className="mt-3 flex flex-col gap-4 pb-2">
            {allNotesCount === 0 && (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No notes yet — tap the pencil button to capture your first one.
              </p>
            )}
            {allNotesCount > 0 && noteGroups.length === 0 && (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {notesScope === 'day' && !notesQuery.trim()
                  ? `No notes on ${friendlyDayLabel(selectedKey)} yet.`
                  : 'No notes match your search.'}
              </p>
            )}
            {renderedGroups.map(([dayKey, list]) => (
              <section key={dayKey} aria-label={`Notes from ${friendlyDayLabel(dayKey)}`}>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {friendlyDayLabel(dayKey)}
                  </h3>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{list.length}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {list.map((note, i) => (
                    <motion.li
                      key={note.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.15) }}
                    >
                      <ReviewNoteCard
                        note={note}
                        outcome={linkedOutcome(note, logsByTaskDay)}
                        onDelete={() => deleteNote(note.id)}
                      />
                    </motion.li>
                  ))}
                </ul>
              </section>
            ))}
            {searchCapped && (
              <p
                data-testid="notes-search-cap"
                className="rounded-xl border border-dashed px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground"
              >
                Showing the first {NOTE_SEARCH_CAP} matches — refine your search to narrow it down.
              </p>
            )}
            {!isSearching && hiddenGroupCount > 0 && (
              <button
                type="button"
                onClick={loadOlderNotes}
                data-testid="notes-load-more"
                className="rounded-xl border border-dashed px-4 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Load older notes
                <span className="ml-1.5 text-xs font-normal tabular-nums">
                  {hiddenGroupCount} more day{hiddenGroupCount === 1 ? '' : 's'}
                </span>
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Did the linked task get done on the note's day? null = standalone note. */
function linkedOutcome(note: Note, byTaskDay: Map<string, Log[]>): 'done' | 'missed' | null {
  if (!note.taskId) return null;
  const key = note.taskDateKey || note.dateKey;
  const list = byTaskDay.get(`${note.taskId}|${key}`);
  if (!list || list.length === 0) return null;
  return list.some((l) => l.status === 'completed') ? 'done' : 'missed';
}

function StatCard({ label, value, hint, testid, delta }: { label: string; value: string; hint: string; testid?: string; delta?: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5" data-testid={testid}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xl font-bold tabular-nums tracking-tight">
        {value}
        {delta}
      </p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Small "vs last week" chip on a stat card. Tone decides the color:
 * good = emerald, bad = rose, neutral = muted. `null` renders nothing
 * (e.g. the previous week had no comparable data).
 */
function DeltaChip({ text, tone }: { text: string; tone: 'good' | 'bad' | 'neutral' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
        tone === 'good' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'bad' && 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
        tone === 'neutral' && 'bg-muted text-muted-foreground'
      )}
      data-testid="week-delta-chip"
    >
      {tone !== 'neutral' &&
        (tone === 'good' ? <TrendingUp className="size-2.5" aria-hidden /> : <TrendingDown className="size-2.5" aria-hidden />)}
      {text}
    </span>
  );
}

/**
 * One day in the progress grid. Renders as a full-width row on phones and
 * as a compact column inside the seven-slot grid from md up — same markup,
 * re-flowed with utility variants.
 */
function DayCell({ day, selected, onSelect }: { day: DayProgress; selected: boolean; onSelect: () => void }) {
  const allDone = day.sessions > 0 && day.done === day.sessions;
  const pct = day.sessions > 0 ? Math.round((day.done / day.sessions) * 100) : 0;

  return (
    <button
      onClick={onSelect}
      aria-label={`${format(parseDayKey(day.key), 'EEEE, d MMMM')}: ${day.done} of ${day.sessions} sessions done${day.trackedSec > 0 ? `, ${formatDuration(day.trackedSec)} tracked` : ''}`}
      aria-pressed={selected}
      data-testid={`week-day-${day.key}`}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors',
        'md:flex-col md:items-center md:gap-1.5 md:px-2 md:py-3 md:text-center',
        selected ? 'border-primary/60 bg-muted/50' : 'hover:bg-muted/40'
      )}
    >
      <span className="flex w-14 shrink-0 flex-col md:w-auto md:items-center">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{day.label}</span>
        <span className={cn('text-sm font-bold leading-tight', isToday(parseDayKey(day.key)) && 'text-primary')}>
          {day.dayNum}
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1 md:w-full md:flex-none">
        <span className="flex items-center justify-between gap-2 md:flex-col md:justify-start md:gap-0">
          <span className="text-xs font-semibold tabular-nums">
            {day.sessions > 0 ? `${day.done}/${day.sessions}` : '—'}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {day.trackedSec > 0 ? formatDuration(day.trackedSec) : '0m'}
          </span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn('block h-full rounded-full transition-[width]', allDone ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>

      <span className="flex h-1.5 shrink-0 items-center gap-[3px] md:h-1" aria-hidden>
        {day.colors.slice(0, 4).map((hex, i) => (
          <span key={i} className="size-1.5 rounded-full" style={{ backgroundColor: hex }} />
        ))}
      </span>
    </button>
  );
}

function ReviewNoteCard({
  note,
  outcome,
  onDelete,
}: {
  note: Note;
  outcome: 'done' | 'missed' | null;
  onDelete: () => void;
}) {
  return <NoteCard note={note} onDelete={onDelete} outcome={outcome} testidPrefix="note-review" />;
}
