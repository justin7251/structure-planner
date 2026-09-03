'use client';

import { useMemo } from 'react';
import { addDays, format, isToday, startOfWeek } from 'date-fns';
import { useAppStore } from '@/store/use-app-store';
import { taskColorMeta } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import type { Log, Task } from '@/types';

/**
 * Structured-style week strip: Mon–Sun with the selected day circled and
 * up to four colored dots per day showing that day's activity (from
 * tracked logs; today also reflects the current plan).
 */
export function WeekStrip({ selectedKey, onSelect }: { selectedKey: string; onSelect?: (key: string) => void }) {
  const tasksRecord = useAppStore((s) => s.tasks);
  const logsRecord = useAppStore((s) => s.logs);

  // Anchor the strip to the week containing *today* — tasks are a daily plan.
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const dotsByDay = useMemo(() => {
    const tasks = tasksRecord as Record<string, Task>;
    const logs = Object.values(logsRecord) as Log[];
    const colorOf = (taskId: string): string | null => {
      const t = tasks[taskId];
      return t && !t.archived ? taskColorMeta(t.color).hex : null;
    };
    const map = new Map<string, string[]>();
    for (const log of logs) {
      const hex = colorOf(log.taskId);
      if (!hex) continue;
      const list = map.get(log.dateKey) ?? [];
      if (!list.includes(hex)) list.push(hex);
      map.set(log.dateKey, list);
    }
    // Today shows planned-but-untracked tasks too (they are the live plan).
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const todayList = map.get(todayKey) ?? [];
    for (const t of Object.values(tasks)) {
      if (t.archived) continue;
      const hex = taskColorMeta(t.color).hex;
      if (!todayList.includes(hex)) todayList.push(hex);
    }
    map.set(todayKey, todayList);
    return map;
  }, [tasksRecord, logsRecord]);

  return (
    <div className="grid grid-cols-7 gap-0.5" role="row" aria-label="This week">
      {days.map((day) => {
        const key = format(day, 'yyyy-MM-dd');
        const selected = key === selectedKey;
        const today = isToday(day);
        const dots = (dotsByDay.get(key) ?? []).slice(0, 4);
        return (
          <button
            key={key}
            onClick={() => onSelect?.(key)}
            aria-label={format(day, 'EEEE, d MMMM')}
            aria-current={today ? 'date' : undefined}
            className={cn(
              'flex min-h-[56px] flex-col items-center gap-1 rounded-xl py-1.5 transition-colors',
              selected ? 'bg-muted/70' : 'hover:bg-muted/40'
            )}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {format(day, 'EEE')}
            </span>
            <span
              className={cn(
                'grid size-7 place-items-center rounded-full text-[13px] font-semibold',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : today
                    ? 'text-primary'
                    : 'text-foreground'
              )}
            >
              {format(day, 'd')}
            </span>
            <span className="flex h-1.5 items-center gap-[3px]" aria-hidden>
              {dots.map((hex, i) => (
                <span key={i} className="size-1.5 rounded-full" style={{ backgroundColor: hex }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
