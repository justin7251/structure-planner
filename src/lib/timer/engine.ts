/**
 * §4.1 — The timer engine is timestamp-based, never counter-based.
 *
 * Elapsed time is ALWAYS computed as Date.now() - startedAt, recalculated
 * fresh whenever the UI needs it (render, visibility change, foreground).
 * This makes the timer immune to JS suspension: backgrounded tabs, lock
 * screens, and throttled intervals cannot lose time.
 */

/** Elapsed milliseconds for a running timer (never negative). */
export function elapsedMs(startedAtEpochMs: number, now: number = Date.now()): number {
  return Math.max(0, now - startedAtEpochMs);
}

/** Elapsed seconds (floored) — the unit stored on logs. */
export function elapsedSeconds(startedAtEpochMs: number, now: number = Date.now()): number {
  return Math.floor(elapsedMs(startedAtEpochMs, now) / 1000);
}
