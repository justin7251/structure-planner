'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Square, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/store/use-app-store';
import { useTicker } from '@/hooks/use-ticker';
import { elapsedMs, elapsedSeconds } from '@/lib/timer/engine';
import { ratioFor } from '@/lib/rating/suggestRating';
import { notifications } from '@/lib/notifications';
import { formatClock, formatDuration } from '@/lib/format';
import { iconMeta, taskColorMeta } from '@/lib/task-style';
import { cn } from '@/lib/utils';

/**
 * §4.2 — Persistent active-timer card. Elapsed time is recomputed fresh
 * on every render from the absolute start timestamp (§4.1), so background
 * suspension, lock screens, and app kills lose nothing. The card is
 * rendered above the tab bar on every screen while a timer runs.
 */
export function ActiveTimerCard() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const task = useAppStore((s) => (s.activeTimer ? s.tasks[s.activeTimer.taskId] : undefined));
  const stopTimer = useAppStore((s) => s.stopTimer);
  const abandonRunning = useAppStore((s) => s.abandonRunning);
  const notificationsEnabled = useAppStore((s) => s.profile.settings.notificationsEnabled);
  const badThreshold = useAppStore((s) => s.profile.settings.defaultRatingThresholds.badThreshold);

  // Recompute for display; never used as a time source.
  const tick = useTicker(!!activeTimer);

  // One-shot notifications when crossing expected / threshold (if enabled).
  // Flags live in refs and are read/written ONLY inside effects — never
  // during render. Reset when the timer changes identity.
  const notifiedRef = useRef({ expected: false, lazy: false });
  const timerId = activeTimer?.logId;
  useEffect(() => {
    notifiedRef.current = { expected: false, lazy: false };
  }, [timerId]);

  useEffect(() => {
    if (!activeTimer || !task || !notificationsEnabled) return;
    const ratio = ratioFor(elapsedSeconds(activeTimer.startedAt), task.expectedDurationMinutes);
    if (ratio == null) return;
    // Copy rules: say WHY it fired, keep it short, offer the next action.
    // `tag` keeps one live alert per timer — the way-over alert replaces
    // the time's-up alert instead of stacking.
    if (ratio > 1 && !notifiedRef.current.expected) {
      notifiedRef.current.expected = true;
      notifications.notify(
        `${task.title}: time's up`,
        `You planned ${formatDuration(task.expectedDurationMinutes * 60)}. Stop to log it — or keep going.`,
        { tag: `timer-${activeTimer.logId}` },
      );
    }
    if (ratio > badThreshold && !notifiedRef.current.lazy) {
      notifiedRef.current.lazy = true;
      notifications.notify(
        `${task.title}: ${badThreshold}× over plan`,
        `${formatDuration(elapsedSeconds(activeTimer.startedAt))} spent, ${formatDuration(task.expectedDurationMinutes * 60)} planned. Time to wrap up.`,
        { tag: `timer-${activeTimer.logId}` },
      );
    }
  }, [tick, activeTimer, task, notificationsEnabled, badThreshold]);

  if (!activeTimer || !task) return null;

  const elapsed = elapsedMs(activeTimer.startedAt);
  const elapsedSec = Math.floor(elapsed / 1000);
  const expectedSec = task.expectedDurationMinutes * 60;
  const ratio = ratioFor(elapsedSec, task.expectedDurationMinutes);

  // Zone colors: on-plan → over plan → way over plan (threshold, §5)
  const zone: 'onplan' | 'over' | 'wayover' =
    ratio == null || ratio <= 1 ? 'onplan' : ratio <= badThreshold ? 'over' : 'wayover';

  const progress = ratio == null ? 0.15 : Math.min(ratio, 1.25) / 1.25;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 96, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="fixed inset-x-0 bottom-[calc(76px+max(env(safe-area-inset-bottom),0.5rem))] z-30 mx-auto w-full max-w-md px-3 md:max-w-[64rem]"
        data-testid="active-timer-card"
      >
        <div
          className={cn(
            'rounded-2xl border bg-card/95 p-3.5 shadow-lg shadow-black/5 backdrop-blur-md transition-colors',
            zone === 'onplan' && 'border-primary/30',
            zone === 'over' && 'border-amber-500/40',
            zone === 'wayover' && 'border-rose-500/40'
          )}
          role="timer"
          aria-label={`Timer running for ${task.title}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full text-white"
                  style={{ backgroundColor: taskColorMeta(task.color).hex }}
                  aria-hidden
                >
                  {(() => {
                    const { Icon } = iconMeta(task.icon);
                    return <Icon className="size-3" />;
                  })()}
                </span>
                <p className="truncate text-sm font-medium">{task.title}</p>
              </div>
              <p className="mt-0.5 pl-4 text-xs text-muted-foreground">
                planned {formatDuration(expectedSec)}
                {ratio != null && (
                  <span className="ml-1.5">
                    · {ratio.toFixed(2)}× plan
                  </span>
                )}
              </p>
            </div>
            <p
              className={cn(
                'font-mono text-2xl font-semibold tabular-nums tracking-tight',
                zone === 'onplan' && 'text-foreground',
                zone === 'over' && 'text-amber-600 dark:text-amber-400',
                zone === 'wayover' && 'text-rose-600 dark:text-rose-400'
              )}
              data-testid="timer-elapsed"
            >
              {formatClock(elapsed)}
            </p>
          </div>

          {/* Elapsed vs expected progress — fills to 1.25× plan */}
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.div
              className={cn(
                'h-full rounded-full',
                zone === 'onplan' && 'bg-primary',
                zone === 'over' && 'bg-amber-500',
                zone === 'wayover' && 'bg-rose-500'
              )}
              style={{ width: `${Math.min(100, progress * 100)}%` }}
              transition={{ ease: 'linear' }}
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                stopTimer();
                toast.success('Session captured', { description: 'How did it go? Rate it below.' });
              }}
              data-testid="stop-timer"
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
              Done
            </button>
            <button
              onClick={() => {
                abandonRunning();
                toast('Timer abandoned', { description: 'Rate the attempt honestly — that is the point.' });
              }}
              data-testid="abandon-timer"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:scale-[0.98]"
            >
              <SkipForward className="size-4" aria-hidden />
              Abandon
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
