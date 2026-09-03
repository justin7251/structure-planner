/**
 * Shared log folds — one implementation for the "latest session today"
 * lookups and the per-day activity dots that the Today timeline, the week
 * review, the Overview calendar and the week strip all need. Previously
 * these were three or four near-identical inline folds.
 */
import { todayKey } from '@/lib/format';
import type { Log } from '@/types';

/** Newest-first logs for one task on one day (default: today). */
export function logsForDay(
  logs: Record<string, Log>,
  taskId: string,
  key: string = todayKey(),
): Log[] {
  return Object.values(logs)
    .filter((l) => l.taskId === taskId && l.dateKey === key)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}

/** The most recent log a task has on a day (default: today). Returns the
 *  stored log object itself, so it is safe as a Zustand selector. */
export function latestLogForDay(
  logs: Record<string, Log>,
  taskId: string,
  key: string = todayKey(),
): Log | undefined {
  return logsForDay(logs, taskId, key)[0];
}

/**
 * Latest log per task for a day (default: today) — a single pass for views
 * that need it for every task at once (the Today timeline blocks).
 */
export function latestLogByTask(
  logs: Record<string, Log>,
  key: string = todayKey(),
): Map<string, Log> {
  const map = new Map<string, Log>();
  for (const log of Object.values(logs)) {
    if (log.dateKey !== key) continue;
    const prev = map.get(log.taskId);
    if (!prev || (log.startedAt ?? '').localeCompare(prev.startedAt ?? '') > 0) {
      map.set(log.taskId, log);
    }
  }
  return map;
}

/**
 * Unique task-color hex per dayKey — the activity-dots fold shared by the
 * Overview month calendar, the week progress grid and the Today week strip.
 * `colorOf` returns null to skip a log (e.g. an archived task's color on
 * the week strip).
 */
export function foldColorDotsByDay(
  logs: Log[],
  colorOf: (taskId: string) => string | null,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const log of logs) {
    const hex = colorOf(log.taskId);
    if (!hex) continue;
    const list = map.get(log.dateKey) ?? [];
    if (!list.includes(hex)) list.push(hex);
    map.set(log.dateKey, list);
  }
  return map;
}
