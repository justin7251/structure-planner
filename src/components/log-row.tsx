'use client';

import { motion } from 'framer-motion';
import { useAppStore } from '@/store/use-app-store';
import { RatingChip } from '@/components/rating-ui';
import { formatDuration, timeOfDay } from '@/lib/format';
import { ratioFor } from '@/lib/rating/suggestRating';
import { iconMeta, taskColorMeta } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import type { Log } from '@/types';

/**
 * The one session/log row, shared by the week review's day detail and the
 * Overview day detail (previously two near-identical copies). Layout:
 * colored icon avatar → title + session line → rating chip / rate affordance.
 *
 * Variants:
 *  - `animated`     — entry animation for the week list; Overview renders
 *                     plain rows.
 *  - `showPlanRatio`— week shows the actual/planned ratio inline.
 *  - `rowClickable` — Overview taps the whole row to open the rating
 *                     moment (Rate renders as a passive chip); the week
 *                     list taps a dedicated Rate button instead.
 */
export function LogRow({
  log,
  onRate,
  testidPrefix,
  animated = false,
  index = 0,
  showPlanRatio = false,
  rowClickable = false,
}: {
  log: Log;
  onRate: () => void;
  /** data-testid prefix: `${testidPrefix}-${log.id}`. */
  testidPrefix: string;
  animated?: boolean;
  index?: number;
  showPlanRatio?: boolean;
  rowClickable?: boolean;
}) {
  const tasksRecord = useAppStore((s) => s.tasks);
  const task = tasksRecord[log.taskId];
  const hex = taskColorMeta(task?.color).hex;
  const { Icon } = iconMeta(task?.icon);
  const notDone = log.status === 'abandoned' && log.startedAt == null;
  const ratio = ratioFor(log.actualDurationSeconds, log.expectedMinutes);
  const over = ratio != null && ratio > 1;

  const middle = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold">{log.taskTitle}</span>
      <span className="block text-[11px] tabular-nums text-muted-foreground">
        {notDone
          ? 'Not done'
          : log.startedAt
            ? `${timeOfDay(log.startedAt)} · ${formatDuration(log.actualDurationSeconds ?? 0)}${
                log.entryMode === 'manual' ? ' · manual' : ''
              }`
            : 'No time recorded'}
        {showPlanRatio && ratio != null && !notDone && (
          <span
            className={cn(
              'font-medium',
              over ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
            )}
          >
            {' '}· {ratio.toFixed(2)}× plan
          </span>
        )}
      </span>
    </span>
  );

  const avatar = (
    <span className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: hex }}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );

  const right = log.rating ? (
    <RatingChip rating={log.rating} />
  ) : rowClickable ? (
    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">
      Rate
    </span>
  ) : (
    <button
      onClick={onRate}
      className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
    >
      Rate
    </button>
  );

  const rowClass = cn(
    'flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left',
    rowClickable && !log.rating && 'cursor-pointer border-amber-500/40 transition-colors hover:bg-muted/40'
  );

  const row =
    rowClickable && !log.rating ? (
      <button type="button" onClick={onRate} className={rowClass} data-testid={`${testidPrefix}-${log.id}`}>
        {avatar}
        {middle}
        {right}
      </button>
    ) : (
      <div className={rowClass} data-testid={`${testidPrefix}-${log.id}`}>
        {avatar}
        {middle}
        {right}
      </div>
    );

  if (!animated) return <li>{row}</li>;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.03, 0.15) }}
    >
      {row}
    </motion.li>
  );
}
