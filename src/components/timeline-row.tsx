'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useAppStore } from '@/store/use-app-store';
import { useTicker } from '@/hooks/use-ticker';
import { formatDuration } from '@/lib/format';
import { latestLogForDay } from '@/lib/logs';
import { iconMeta, taskColorMeta, taskTextClass } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';

/**
 * Row style shared with the timeline, used for unscheduled "Anytime"
 * tasks: glyph in the task color, title, planned duration, status circle.
 */
export function TaskTimelineRowStyle({
  task,
  index = 0,
}: {
  task: Task;
  /** Ignored; the row reads the live timer itself. */
  onOpen?: () => void;
  index?: number;
}) {
  const openTaskActions = useAppStore((s) => s.openTaskActions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const latestLog = useAppStore((s) => latestLogForDay(s.logs, task.id));
  const isRunning = activeTimer?.taskId === task.id;

  // Cosmetic tick keeps the live elapsed honest (§4.1).
  useTicker(isRunning);

  const meta = taskColorMeta(task.color);
  const { Icon } = iconMeta(task.icon);
  // Done is done — rating is reflection, not completion (quick-completes are untimed).
  const completedToday = latestLog?.status === 'completed';
  const notDone = latestLog?.status === 'abandoned' && latestLog.startedAt == null;

  let subtitle: string | null = formatDuration(task.expectedDurationMinutes * 60) + ' planned';
  if (isRunning && activeTimer) {
    const remaining = task.expectedDurationMinutes * 60 - (Date.now() - activeTimer.startedAt) / 1000;
    subtitle =
      remaining >= 0
        ? `${formatDuration(remaining)} remaining`
        : `${formatDuration(-remaining)} over plan`;
  } else if (completedToday && latestLog?.actualDurationSeconds != null) {
    subtitle = `${formatDuration(latestLog.actualDurationSeconds)} actual`;
  } else if (completedToday) {
    subtitle = 'Done · untimed';
  } else if (notDone) {
    subtitle = 'Marked not done';
  }

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.15), duration: 0.2, ease: 'easeOut' }}
      onClick={() => openTaskActions(task.id)}
      className={cn(
        'flex w-full min-h-[56px] items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors',
        isRunning && 'border-primary/40'
      )}
      data-testid={`anytime-task-${task.id}`}
      aria-label={`${task.title}, ${formatDuration(task.expectedDurationMinutes * 60)} planned`}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full text-white shadow-sm"
        style={{ backgroundColor: meta.hex }}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px] font-semibold leading-tight', taskTextClass(task.color))}>
          {task.title}
        </span>
        <span
          className={cn(
            'mt-0.5 block text-[11px] font-medium tabular-nums',
            isRunning ? 'text-primary' : notDone ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {subtitle}
        </span>
        {task.detail && (
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted-foreground/80">{task.detail}</span>
        )}
      </span>
      {completedToday ? (
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundColor: meta.hex }}
          aria-label="Completed"
        >
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      ) : isRunning ? (
        <span className="relative grid size-6 shrink-0 place-items-center" aria-label="Running">
          <span className="absolute size-6 animate-ping rounded-full bg-primary/30" aria-hidden />
          <span className="size-3 rounded-full bg-primary" />
        </span>
      ) : (
        <span className="size-6 shrink-0 rounded-full border-2 border-border" aria-hidden />
      )}
    </motion.button>
  );
}
