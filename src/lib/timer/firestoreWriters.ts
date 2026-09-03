/**
 * §4.2 — Write path.
 *
 * LOCAL-FIRST WRITE SURFACE: every write lands in the persisted Zustand
 * cache first (the UI's source of truth), then `lib/sync/firestore-sync.ts`
 * mirrors the change to Firestore while a session is live — including
 * replaying queued writes made offline. The two layers are decoupled:
 * cloud outages never block or break a local write.
 */
import { useAppStore } from '@/store/use-app-store';
import type { ActiveTimer, Log } from '@/types';

/** Create a new log document (e.g. status 'running' when a timer starts). */
export function writeNewLog(log: Log): void {
  useAppStore.setState((state) => ({
    logs: { ...state.logs, [log.id]: log },
  }));
}

/** Patch an existing log document (completion, rating, abandon…). */
export function writeLogUpdate(logId: string, patch: Partial<Log>): void {
  useAppStore.setState((state) => {
    const existing = state.logs[logId];
    if (!existing) return state;
    return {
      logs: {
        ...state.logs,
        [logId]: { ...existing, ...patch, syncedAt: new Date().toISOString() },
      },
    };
  });
}

/** Mirror / clear the active timer reference used for instant UI reactivity (§4.2). */
export function writeActiveTimer(timer: ActiveTimer | null): void {
  useAppStore.setState({ activeTimer: timer });
}
