'use client';

import { useState, type ReactNode } from 'react';
import { Archive, Check, ChevronDown, ChevronRight, ClockPlus, NotebookPen, Pencil, Play, SkipForward, Square, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  FullScreenModal,
  ModalContent,
  ModalDescription,
  ModalTitle,
} from '@/components/ui/full-screen-modal';
import { useAppStore, selectNotesForTask } from '@/store/use-app-store';
import { formatDuration, friendlyDayLabel, planDayLabel, timeOfDay, todayKey } from '@/lib/format';
import { iconMeta, taskColorMeta, taskTextClass, colorWithAlpha } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';

/**
 * Structured-style task quick bar — deliberately compact, because tapping a
 * task is usually a two-second decision ("start it / done it / tweak it").
 *
 *   1. Identity strip  — what this is + today's state, one slim row.
 *   2. Action tiles    — Complete · Start timer · Edit, side by side.
 *                        Running task collapses the row into "Stop & rate".
 *   3. More actions    — collapsed by default; expands in place for the
 *                        occasional stuff (note, manual log, skip, archive,
 *                        delete, notes, recent sessions).
 *
 * Default height is about a third of the old sheet; nothing was removed —
 * it just stays out of the way until asked for.
 */
export function TaskActionsSheet() {
  const open = useAppStore((s) => s.taskActionsOpen);
  const task = useAppStore((s) => (s.actionsTaskId ? s.tasks[s.actionsTaskId] : undefined));
  const close = useAppStore((s) => s.closeTaskActions);
  const activeTimer = useAppStore((s) => s.activeTimer);

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && close()}>
      <ModalContent data-testid="task-actions-sheet">
        {open && task && (
          <TaskActionsBody task={task} activeTimerTaskId={activeTimer?.taskId ?? null} />
        )}
      </ModalContent>
    </FullScreenModal>
  );
}

function TaskActionsBody({
  task,
  activeTimerTaskId,
}: {
  task: Task;
  activeTimerTaskId: string | null;
}) {
  const close = useAppStore((s) => s.closeTaskActions);
  const logs = useAppStore((s) => s.logs);
  const [moreOpen, setMoreOpen] = useState(false);

  const meta = taskColorMeta(task.color);
  const { Icon } = iconMeta(task.icon);

  const runningThis = activeTimerTaskId === task.id;
  const runningOther = activeTimerTaskId != null && !runningThis;

  const latestToday = latestTodayLog(task.id, logs);
  const doneToday = latestToday?.status === 'completed';
  const notDoneToday = latestToday?.status === 'abandoned' && latestToday.startedAt == null;

  return (
    <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),0.5rem)]">
      <ModalTitle className="sr-only">Actions for {task.title}</ModalTitle>
      <ModalDescription className="sr-only">Choose an action</ModalDescription>

      {/* 0 — Close affordance: full-screen modals have no swipe-out, so
          an explicit close must live within thumb's reach. */}
      <div className="mb-1 flex justify-end">
        <button
          onClick={close}
          aria-label="Close"
          data-testid="actions-close"
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* 1 — Identity strip: what this is + today's state */}
      <div
        className="rounded-2xl border p-2.5"
        style={{
          backgroundColor: colorWithAlpha(meta.hex, '12'),
          borderColor: colorWithAlpha(meta.hex, '2e'),
        }}
        data-testid="actions-header"
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-white shadow-sm"
            style={{ backgroundColor: meta.hex }}
          >
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('truncate text-sm font-semibold leading-tight', taskTextClass(task.color))}>
              {task.title}
            </p>
            <p className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(task.expectedDurationMinutes * 60)}
              {task.scheduledDateKey && task.scheduledDateKey !== todayKey()
                ? ` · ${planDayLabel(task.scheduledDateKey)}`
                : ''}
              {task.scheduledStart ? ` · from ${task.scheduledStart}` : ' · anytime'}
              {task.category ? ` · ${task.category}` : ''}
            </p>
          </div>
          {runningThis ? (
            <StatusChip tone="primary">Running</StatusChip>
          ) : doneToday ? (
            <StatusChip tone="success">
              <Check className="size-3" strokeWidth={3} aria-hidden />
              {latestToday?.completedAt ? timeOfDay(latestToday.completedAt) : 'Done'}
            </StatusChip>
          ) : notDoneToday ? (
            <StatusChip tone="muted">Not done</StatusChip>
          ) : null}
        </div>
        {task.detail && (
          <p className="mt-1.5 line-clamp-2 border-t pt-1.5 text-xs leading-relaxed text-muted-foreground" style={{ borderColor: colorWithAlpha(meta.hex, '2e') }}>
            {task.detail}
          </p>
        )}
      </div>

      {/* 2 — Action tiles: the daily decisions, one tap away */}
      {runningThis ? (
        <button
          onClick={() => {
            useAppStore.getState().stopTimer();
            close();
            toast.success('Session captured', { description: 'How did it go? Rate it below.' });
          }}
          className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-[15px] font-bold text-white shadow-lg shadow-red-600/25 transition-transform active:scale-[0.99]"
          data-testid="actions-stop"
        >
          <Square className="size-4 fill-current" aria-hidden />
          Stop & rate
        </button>
      ) : (
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {/* Complete — untimed, honest (no invented duration), instantly done */}
          <button
            onClick={() => {
              const ok = useAppStore.getState().markCompleteToday(task.id);
              if (!ok) {
                toast('Already completed today');
                return;
              }
              close();
              toast.success('Marked done', {
                description: 'Untimed — rate it later from History if you like.',
              });
            }}
            disabled={doneToday}
            className={cn(
              'flex h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-[13px] font-bold transition-transform active:scale-[0.99]',
              doneToday
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25',
            )}
            data-testid="actions-complete"
          >
            <Check className="size-4" strokeWidth={3} aria-hidden />
            {doneToday && latestToday?.completedAt ? timeOfDay(latestToday.completedAt) : 'Complete'}
          </button>
          <button
            onClick={() => {
              const ok = useAppStore.getState().startTimer(task.id);
              if (!ok) {
                toast.warning('A timer is already running', {
                  description: 'Stop or abandon the current timer before starting another task.',
                });
                return;
              }
              close();
            }}
            disabled={runningOther}
            className={cn(
              'flex h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-[13px] font-bold text-white transition-transform active:scale-[0.99]',
              runningOther ? 'opacity-40' : '',
            )}
            style={{
              backgroundColor: meta.hex,
              boxShadow: runningOther ? undefined : `0 6px 18px ${colorWithAlpha(meta.hex, '40')}`,
            }}
            data-testid="actions-start"
          >
            <Play className="size-4 fill-current" aria-hidden />
            {runningOther ? 'Timer busy' : 'Start'}
          </button>
          <button
            onClick={() => {
              close();
              useAppStore.getState().openTaskForm(task.id);
            }}
            className="flex h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border bg-card text-[13px] font-bold text-foreground transition-colors hover:bg-muted/60 active:scale-[0.99]"
            data-testid="actions-edit"
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </button>
        </div>
      )}

      {/* 3 — More actions: everything occasional, collapsed until asked for */}
      <button
        onClick={() => setMoreOpen((o) => !o)}
        aria-expanded={moreOpen}
        className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60"
        data-testid="actions-more-toggle"
      >
        {moreOpen ? 'Fewer actions' : 'More actions'}
        <ChevronDown className={cn('size-3.5 transition-transform duration-300', moreOpen && 'rotate-180')} aria-hidden />
      </button>

      <div
        aria-hidden={!moreOpen}
        inert={!moreOpen}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(.32,.72,0,1)]',
          moreOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        data-testid="actions-more"
      >
        <div className="overflow-hidden">
          <div className="mt-2 overflow-hidden rounded-2xl border">
            <SheetRow
              icon={NotebookPen}
              label="Add a note"
              testid="actions-note"
              onClick={() => {
                close();
                useAppStore.getState().openNoteTaker(task.id);
              }}
            />
            <SheetRow
              icon={ClockPlus}
              label="Log time manually"
              testid="actions-manual"
              onClick={() => {
                close();
                useAppStore.getState().openManualTime(task.id);
              }}
            />
            <SheetRow
              icon={SkipForward}
              label="Didn't do it today"
              testid="actions-skip"
              disabled={runningThis}
              onClick={() => {
                if (latestToday?.status === 'abandoned' && latestToday.startedAt == null) {
                  toast('Already marked as not done today');
                  close();
                  return;
                }
                useAppStore.getState().markNotDone(task.id);
                close();
              }}
            />
            <div className="h-px bg-border" aria-hidden />
            <SheetRow
              icon={Archive}
              label="Archive"
              testid="actions-archive"
              disabled={runningThis}
              onClick={() => {
                useAppStore.getState().archiveTask(task.id);
                close();
                toast.success(`Archived "${task.title}"`, {
                  description: 'Find it under Settings → Archived tasks to restore.',
                });
              }}
            />
            <SheetRow
              icon={Trash2}
              label="Delete task"
              testid="actions-delete"
              destructive
              disabled={runningThis}
              onClick={() => {
                useAppStore.getState().deleteTask(task.id);
                close();
                toast.success('Task deleted');
              }}
            />
          </div>

          <TaskNotes taskId={task.id} />
          <RecentNote taskId={task.id} />
          <div className="h-3" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function latestTodayLog(taskId: string, logs: ReturnType<typeof useAppStore.getState>['logs']) {
  const key = todayKey();
  return Object.values(logs)
    .filter((l) => l.taskId === taskId && l.dateKey === key)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
}

function StatusChip({ tone, children }: { tone: 'primary' | 'success' | 'muted'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums',
        tone === 'primary' && 'bg-primary/15 text-primary',
        tone === 'success' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        tone === 'muted' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** A quiet list row in a grouped section — icon chip, label, chevron. */
function SheetRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
  testid,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testid?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={cn(
        'flex min-h-[46px] w-full items-center gap-3 px-3 text-left transition-colors',
        disabled ? 'opacity-40' : 'hover:bg-muted/60 active:bg-muted',
      )}
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full',
          destructive ? 'bg-destructive/10' : 'bg-muted',
        )}
      >
        <Icon className={cn('size-3.5', destructive ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
      </span>
      <span className={cn('flex-1 text-sm font-medium', destructive ? 'text-destructive' : 'text-foreground')}>
        {label}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" aria-hidden />
    </button>
  );
}

/** Notes captured about this task via the Note Taker, newest first. */
function TaskNotes({ taskId }: { taskId: string }) {
  const notesRecord = useAppStore((s) => s.notes);
  const linked = selectNotesForTask(notesRecord, taskId).slice(0, 5);

  if (linked.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2" data-testid="task-notes">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notes about this task</p>
      <ul className="mt-1 space-y-1.5">
        {linked.map((note) => (
          <li key={note.id} className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
              <span className="mr-1.5 tabular-nums text-muted-foreground">{timeOfDay(note.createdAt)}</span>
              {note.text}
            </p>
            <button
              onClick={() => useAppStore.getState().deleteNote(note.id)}
              aria-label="Delete note"
              className="shrink-0 rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Last 3 timed sessions for this task, for a bit of context at decision time. */
function RecentNote({ taskId }: { taskId: string }) {
  const logs = useAppStore((s) => s.logs);
  const recent = Object.values(logs)
    .filter((l) => l.taskId === taskId && l.actualDurationSeconds != null)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    .slice(0, 3);

  if (recent.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent sessions</p>
      <ul className="mt-1 space-y-0.5">
        {recent.map((log) => (
          <li key={log.id} className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{log.startedAt ? timeOfDay(log.startedAt) : '—'} · {formatDuration(log.actualDurationSeconds ?? 0)}</span>
            <span className="tabular-nums">{friendlyDayLabel(log.dateKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
