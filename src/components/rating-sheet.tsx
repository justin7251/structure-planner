'use client';

import { AlarmClock, Coffee, Trophy } from 'lucide-react';
import { FullScreenModal, ModalContent, ModalDescription, ModalHeader, ModalTitle } from '@/components/ui/full-screen-modal';
import { useAppStore } from '@/store/use-app-store';
import { deltaLabel, formatDuration } from '@/lib/format';
import { ratioFor } from '@/lib/rating/suggestRating';
import { cn } from '@/lib/utils';
import type { Rating } from '@/types';
import { ratingMeta } from '@/components/rating-ui';

const ORDER: Rating[] = ['excellent', 'bad', 'lazy'];

const SUGGESTION_COPY: Record<Rating, string> = {
  excellent: 'Finished within the planned time. Trust this estimate next time.',
  bad: 'Overran the plan — the estimate was close but optimistic.',
  lazy: 'Way over plan, or never really happened. Worth reflecting on why.',
};

/**
 * §5 — The reflective moment. The app suggests; the user decides.
 * Suggestion and final rating are both stored (ratingSource preserves
 * whether the suggestion was accepted, confirmed from scratch, or
 * overridden — fuel for later analytics).
 */
export function RatingSheet() {
  const logId = useAppStore((s) => s.ratingSheetLogId);
  const log = useAppStore((s) => (s.ratingSheetLogId ? s.logs[s.ratingSheetLogId] : undefined));
  const detailForTask = useAppStore((s) => (log ? s.tasks[log.taskId]?.detail ?? null : null));
  const confirmRating = useAppStore((s) => s.confirmRating);
  const closeRatingSheet = useAppStore((s) => s.closeRatingSheet);

  const open = !!logId && !!log;
  const ratio = log ? ratioFor(log.actualDurationSeconds, log.expectedMinutes) : null;
  const suggested = log?.suggestedRating ?? null;
  const hasDuration = log?.actualDurationSeconds != null;

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && closeRatingSheet()}>
      <ModalContent data-testid="rating-sheet">
        <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
          <ModalHeader className="p-0 text-left">
            <ModalTitle className="text-lg">
              {log?.status === 'abandoned' && log?.startedAt == null
                ? 'You skipped this one'
                : 'How did it actually go?'}
            </ModalTitle>
            <ModalDescription className="text-left">
              {log?.taskTitle}
              {log?.status === 'abandoned' && log?.startedAt == null && (
                <> — marked as not done. Honest ratings build honest plans.</>
              )}
              {detailForTask && <span className="block text-[11px] opacity-80">{detailForTask}</span>}
            </ModalDescription>
          </ModalHeader>

          {log && (
            <div className="mt-3 rounded-xl border bg-muted/40 px-3.5 py-3" data-testid="rating-context">
              {hasDuration ? (
                <>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">
                      {formatDuration(log.expectedMinutes * 60)} planned
                    </span>
                    <span className="font-mono text-base font-semibold">
                      {formatDuration(log.actualDurationSeconds ?? 0)} actual
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {log.actualDurationSeconds != null &&
                        deltaLabel(log.actualDurationSeconds, log.expectedMinutes)}{' '}
                      vs plan
                    </span>
                    {ratio != null && (
                      <span
                        className={cn(
                          'font-semibold',
                          ratio <= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                        )}
                      >
                        {ratio.toFixed(2)}× the estimate
                      </span>
                    )}
                  </div>
                  {/* ratio ruler: 1.0 marker and threshold-agnostic fill */}
                  <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        ratio != null && ratio <= 1 ? 'bg-emerald-500' : 'bg-amber-500'
                      )}
                      style={{ width: `${Math.min(100, ((ratio ?? 1) / 2) * 100)}%` }}
                    />
                    {/* 1.0× marker sits at 50% on the 0–2× scale */}
                    <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground/50" />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70">
                    <span>0×</span>
                    <span>1× plan</span>
                    <span>2×</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No time was tracked for this attempt.
                </p>
              )}
            </div>
          )}

          {suggested && (
            <p className="mt-3 px-1 text-xs text-muted-foreground" data-testid="suggestion-hint">
              Based on your numbers, we&apos;d call this{' '}
              <span className={cn('font-semibold', ratingMeta[suggested].text)}>
                {suggested}
              </span>
              . {SUGGESTION_COPY[suggested]}
            </p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Rate this attempt">
            {ORDER.map((r) => {
              const meta = ratingMeta[r];
              const Icon = r === 'excellent' ? Trophy : r === 'bad' ? AlarmClock : Coffee;
              const isSuggested = suggested === r;
              return (
                <button
                  key={r}
                  role="radio"
                  aria-checked={false}
                  onClick={() => {
                    confirmRating(log!.id, r);
                    closeRatingSheet();
                  }}
                  data-testid={`rate-${r}`}
                  className={cn(
                    'relative flex min-h-[86px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-sm font-semibold transition-all active:scale-[0.96]',
                    isSuggested
                      ? meta.solid + ' shadow-sm'
                      : 'border-border bg-background text-foreground hover:bg-muted/50'
                  )}
                >
                  {isSuggested && (
                    <span className="absolute -top-2 rounded-full bg-foreground px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-background">
                      Suggested
                    </span>
                  )}
                  <Icon className="size-5" aria-hidden />
                  {meta.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={closeRatingSheet}
            className="mt-3 w-full rounded-xl py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            data-testid="rating-decide-later"
          >
            Decide later
          </button>
        </div>
      </ModalContent>
    </FullScreenModal>
  );
}
