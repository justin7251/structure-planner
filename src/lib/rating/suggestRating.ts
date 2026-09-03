import type { LogStatus, Rating, RatingThresholds } from '@/types';

/**
 * §5 — Rating logic (suggested, not automatic).
 *
 *   ratio = actualDuration / expectedDuration
 *
 *   abandoned          → 'lazy'
 *   ratio <= 1.0       → 'excellent'
 *   ratio <= threshold → 'bad'       (e.g. 1.0–1.5x)
 *   else               → 'lazy'      (much longer than planned)
 *
 * Returns null when no fair suggestion can be made (no expected duration,
 * or no measurable duration) — the user can still rate manually, which is
 * recorded as ratingSource 'user_confirmed'.
 */
export function suggestRating(input: {
  status: LogStatus;
  expectedMinutes: number;
  actualSeconds: number | null;
  thresholds: RatingThresholds;
}): Rating | null {
  const { status, expectedMinutes, actualSeconds, thresholds } = input;

  if (status === 'abandoned') return 'lazy';
  if (expectedMinutes <= 0 || actualSeconds == null) return null;

  const ratio = actualSeconds / (expectedMinutes * 60);
  if (ratio <= 1.0) return 'excellent';
  if (ratio <= thresholds.badThreshold) return 'bad';
  return 'lazy';
}

/** ratio of actual vs expected; null when it cannot be computed. */
export function ratioFor(actualSeconds: number | null, expectedMinutes: number): number | null {
  if (actualSeconds == null || expectedMinutes <= 0) return null;
  return actualSeconds / (expectedMinutes * 60);
}
