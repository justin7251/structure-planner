'use client';

import { useState, useMemo } from 'react';
import { FullScreenModal, ModalContent, ModalDescription, ModalHeader, ModalTitle } from '@/components/ui/full-screen-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore, selectSortedActiveTasks } from '@/store/use-app-store';
import { dateKeyOf, formatDuration, friendlyDayLabel, parseTimeOfDay } from '@/lib/format';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';

type Mode = 'duration' | 'range';

/**
 * §3.1 — Manual (backfilled) time entry.
 *
 * For when users forget to start the timer. Two shapes:
 *   a) a start time + end time, or
 *   b) just a duration (startedAt defaults to the task's scheduledStart
 *      if one exists, otherwise the user picks a time)
 *
 * Writes the same log shape as a live-tracked session with
 * entryMode: 'manual', then runs the identical suggestRating flow.
 *
 * The fields component remounts on each open, so defaults derive from
 * the preselected task at mount — no effects.
 */
export function ManualTimeSheet() {
  const open = useAppStore((s) => s.manualTimeOpen);
  const preselectedId = useAppStore((s) => s.manualTimeTaskId);
  const tasksRecord = useAppStore((s) => s.tasks);
  const tasks = useMemo(() => selectSortedActiveTasks(tasksRecord), [tasksRecord]);
  const closeManualTime = useAppStore((s) => s.closeManualTime);

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && closeManualTime()}>
      <ModalContent data-testid="manual-time-sheet">
        {open && tasks.length > 0 && (
          <ManualTimeFields
            key={preselectedId ?? tasks[0].id}
            tasks={tasks}
            initialTaskId={preselectedId ?? tasks[0].id}
            onCancel={closeManualTime}
          />
        )}
      </ModalContent>
    </FullScreenModal>
  );
}

function ManualTimeFields({
  tasks,
  initialTaskId,
  onCancel,
}: {
  tasks: Task[];
  initialTaskId: string;
  onCancel: () => void;
}) {
  const addManualLog = useAppStore((s) => s.addManualLog);
  const logsRecord = useAppStore((s) => s.logs);

  const [taskId, setTaskId] = useState(initialTaskId);
  const [mode, setMode] = useState<Mode>('duration');
  const initial = tasks.find((t) => t.id === initialTaskId);
  const [durationMin, setDurationMin] = useState(String(initial?.expectedDurationMinutes ?? 30));
  const [date, setDate] = useState(() => dateKeyOf(new Date()));
  const [startTime, setStartTime] = useState(initial?.scheduledStart ?? '09:00');
  const [endTime, setEndTime] = useState(
    addMinutes(initial?.scheduledStart ?? '09:00', initial?.expectedDurationMinutes ?? 60)
  );
  const [useTaskDefaultStart, setUseTaskDefaultStart] = useState(!!initial?.scheduledStart);

  const task = tasks.find((t) => t.id === taskId);

  // §3.1 dedupe preview — what does the chosen task+date already have?
  const dayLogs = useMemo(
    () => Object.values(logsRecord).filter((l) => l.taskId === taskId && l.dateKey === date),
    [logsRecord, taskId, date],
  );
  const timedSecondsToday = dayLogs.reduce(
    (sum, l) => sum + (l.status === 'completed' ? l.actualDurationSeconds ?? 0 : 0),
    0,
  );
  const willMerge =
    timedSecondsToday === 0 &&
    dayLogs.some(
      (l) =>
        (l.status === 'completed' && l.actualDurationSeconds == null) ||
        (l.status === 'abandoned' && l.startedAt == null),
    );

  /** When the user switches tasks, refresh the smart defaults (event-driven, no effect). */
  const pickTask = (id: string) => {
    const next = tasks.find((t) => t.id === id);
    setTaskId(id);
    setDurationMin(String(next?.expectedDurationMinutes ?? 30));
    setStartTime(next?.scheduledStart ?? '09:00');
    setEndTime(addMinutes(next?.scheduledStart ?? '09:00', next?.expectedDurationMinutes ?? 60));
    setUseTaskDefaultStart(!!next?.scheduledStart);
  };

  const submit = () => {
    if (!task) {
      toast.error('Pick a task first');
      return;
    }
    const mins = Math.round(Number(durationMin));

    let startedAt: Date;
    let durationSeconds: number;

    if (mode === 'range') {
      const startSec = parseTimeOfDay(startTime);
      const endSec = parseTimeOfDay(endTime);
      if (startSec == null || endSec == null) {
        toast.error('Enter both a start and an end time');
        return;
      }
      let end = endSec;
      if (endSec <= startSec) end += 24 * 3600; // crosses midnight
      durationSeconds = end - startSec;
      if (durationSeconds < 60) {
        toast.error('That session is shorter than a minute');
        return;
      }
      startedAt = combine(date, startTime);
    } else {
      if (!Number.isFinite(mins) || mins < 1) {
        toast.error('Enter the duration in minutes');
        return;
      }
      durationSeconds = mins * 60;
      // §3.1b: duration-only → startedAt defaults to scheduledStart when present
      if (useTaskDefaultStart && task.scheduledStart) {
        startedAt = combine(date, task.scheduledStart);
      } else {
        startedAt = combine(date, startTime);
      }
    }

    if (startedAt.getTime() > Date.now()) {
      toast.error('That start time is in the future');
      return;
    }

    const { merged } = addManualLog({
      taskId: task.id,
      startedAt: startedAt.toISOString(),
      durationSeconds,
    });
    if (merged) {
      toast.success('Combined into one entry', {
        description: 'Filled in your earlier check-in for that day — no duplicate log.',
      });
    } else {
      toast.success('Time logged', { description: 'Now rate it honestly — manual or not.' });
    }
    onCancel();
  };

  return (
    <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
      <ModalHeader className="p-0 text-left">
        <ModalTitle className="text-lg">Log time after the fact</ModalTitle>
        <ModalDescription>
          Forgot the timer? Add the session manually — it will be flagged as manual in history.
        </ModalDescription>
      </ModalHeader>

      <div className="mt-4 flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label>Task</Label>
          <Select value={taskId} onValueChange={pickTask}>
            <SelectTrigger className="w-full" data-testid="manual-task-select">
              <SelectValue placeholder="Choose a task" />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label>Date</Label>
          <Input
            type="date"
            max={dateKeyOf(new Date())}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Entry mode">
          {(
            [
              { id: 'duration', label: 'Duration' },
              { id: 'range', label: 'Start → End' },
            ] as Array<{ id: Mode; label: string }>
          ).map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              data-testid={`manual-mode-${m.id}`}
              className={cn(
                'h-9 rounded-lg text-sm font-medium transition-all',
                mode === m.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'duration' ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="manual-duration">How long? (minutes)</Label>
              <Input
                id="manual-duration"
                type="number"
                inputMode="numeric"
                min={1}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                data-testid="manual-duration-input"
              />
            </div>
            {task?.scheduledStart && (
              <div className="flex items-center justify-between rounded-xl border px-3.5 py-3">
                <div>
                  <p className="text-sm font-medium">Use planned start</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Assume it began at {task.scheduledStart}, as planned
                  </p>
                </div>
                <Switch checked={useTaskDefaultStart} onCheckedChange={setUseTaskDefaultStart} />
              </div>
            )}
            {(!task?.scheduledStart || !useTaskDefaultStart) && (
              <div className="grid gap-1.5">
                <Label htmlFor="manual-start">Started at</Label>
                <Input
                  id="manual-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-36"
                />
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="manual-range-start">Started</Label>
              <Input
                id="manual-range-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="manual-range-end">Ended</Label>
              <Input
                id="manual-range-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Duplicate guard: say what saving will do before it does it. */}
        {timedSecondsToday > 0 && (
          <p
            data-testid="manual-duplicate-warning"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
          >
            {formatDuration(timedSecondsToday)} already logged for this task on{' '}
            {friendlyDayLabel(date)} — saving adds another session for that day.
          </p>
        )}
        {willMerge && (
          <p
            data-testid="manual-merge-hint"
            className="rounded-xl border bg-muted/40 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground"
          >
            This will fill in your earlier untimed check-in for {friendlyDayLabel(date)} — no
            duplicate entry.
          </p>
        )}

        <div className="mt-1 flex gap-2">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl font-semibold" onClick={submit} data-testid="manual-submit">
            Log time
          </Button>
        </div>
      </div>
    </div>
  );
}

function addMinutes(hhmm: string, mins: number): string {
  const sec = (parseTimeOfDay(hhmm) ?? 0) + mins * 60;
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function combine(dateStr: string, hhmm: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const sec = parseTimeOfDay(hhmm) ?? 0;
  const dt = new Date(y, (mo ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  dt.setSeconds(sec);
  return dt;
}
