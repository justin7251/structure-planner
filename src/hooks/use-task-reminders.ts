'use client';

import { useEffect } from 'react';
import { formatDuration, parseTimeOfDay, todayKey } from '@/lib/format';
import { notifications } from '@/lib/notifications';
import { useAppStore } from '@/store/use-app-store';

/** How long before the scheduled start the heads-up fires. */
const REMIND_BEFORE_MIN = 10;

/**
 * "Starting soon" reminders: a 10-minute heads-up before every scheduled
 * task still ahead today (never for tasks already completed today).
 *
 * Scheduling is local (setTimeout) so a plan change cancels the stale
 * timers — the notification itself still goes through the platform
 * adapter (permission-checked there). Web reminders only fire while the
 * tab is alive; native shells replace this hook's body with the OS
 * scheduler.
 *
 * Copy rules (same as the timer alerts): the title says WHAT and WHEN,
 * the body says WHY it matters and what to do — short, one action.
 */
export function useTaskReminders() {
  const tasksRecord = useAppStore((s) => s.tasks);
  const logsRecord = useAppStore((s) => s.logs);
  const enabled = useAppStore((s) => s.profile.settings.notificationsEnabled);

  useEffect(() => {
    if (!enabled) return;

    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const key = todayKey();
    const doneToday = new Set(
      Object.values(logsRecord)
        .filter((l) => l.dateKey === key && l.status === 'completed')
        .map((l) => l.taskId),
    );

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const t of Object.values(tasksRecord)) {
      if (t.archived || !t.scheduledStart) continue;
      if (t.scheduledDateKey && t.scheduledDateKey !== key) continue;
      if (doneToday.has(t.id)) continue;
      const startSec = parseTimeOfDay(t.scheduledStart);
      if (startSec == null) continue;
      const fireSec = startSec - REMIND_BEFORE_MIN * 60;
      if (fireSec <= nowSec) continue; // reminder window already passed

      const delayMs = (fireSec - nowSec) * 1000;
      timers.push(
        setTimeout(() => {
          notifications.notify(
            `In ${REMIND_BEFORE_MIN} min: ${t.title}`,
            `Starts at ${t.scheduledStart} · planned ${formatDuration(t.expectedDurationMinutes * 60)}${t.detail ? ` — ${t.detail}` : ''}`,
            { tag: `reminder-${t.id}-${key}` },
          );
        }, Math.min(delayMs, 2_100_000_000)),
      );
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [tasksRecord, logsRecord, enabled]);
}
