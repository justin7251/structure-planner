/**
 * Demo seed data — gives the preview a realistic two-week history so the
 * reflective features (trends, accuracy stats, overrides) are visible
 * immediately. Seeding only runs on a completely empty store; users can
 * reset from Settings at any time.
 */
import { genId } from '@/lib/id';
import { suggestRating } from '@/lib/rating/suggestRating';
import { dateKeyOf } from '@/lib/format';
import type { Log, Note, Profile, Rating, Task, TaskColor } from '@/types';

interface SeedTaskSpec {
  title: string;
  category: string | null;
  detail?: string;
  expectedDurationMinutes: number;
  scheduledStart: string | null;
  color: TaskColor;
  icon: string;
}

const SEED_TASKS: SeedTaskSpec[] = [
  { title: 'Morning stretch & mobility', category: 'Health', detail: 'Push-ups × 20 · plank 60s', expectedDurationMinutes: 15, scheduledStart: '07:00', color: 'yellow', icon: 'sun' },
  { title: 'Deep work — product deck', category: 'Focus', detail: 'Slides 1–10 · Q3 revenue section', expectedDurationMinutes: 90, scheduledStart: '09:00', color: 'blue', icon: 'laptop' },
  { title: 'Inbox zero', category: 'Admin', detail: 'Clear to exactly 0, archive old threads', expectedDurationMinutes: 20, scheduledStart: '11:30', color: 'coral', icon: 'mail' },
  { title: 'Lunch walk', category: 'Health', detail: 'Around the block, no phone', expectedDurationMinutes: 30, scheduledStart: '13:00', color: 'green', icon: 'bike' },
  { title: 'Code review pass', category: 'Focus', detail: 'PR #142 auth refactor', expectedDurationMinutes: 45, scheduledStart: '15:00', color: 'teal', icon: 'code' },
  { title: 'Spanish practice', category: 'Learning', detail: 'Lesson 12 · past tense drills', expectedDurationMinutes: 25, scheduledStart: '18:00', color: 'purple', icon: 'languages' },
  { title: 'Tidy the flat', category: 'Home', detail: 'Desk + kitchen counter', expectedDurationMinutes: 20, scheduledStart: '20:00', color: 'orange', icon: 'home' },
  { title: 'Read (non-screen)', category: 'Learning', detail: 'Pages 110–120', expectedDurationMinutes: 30, scheduledStart: '21:30', color: 'pink', icon: 'book' },
  { title: 'Call Mum', category: null, detail: 'Sunday evening catch-up', expectedDurationMinutes: 15, scheduledStart: null, color: 'green', icon: 'phone' },
];

/** Small deterministic-ish PRNG so reseeds feel stable but still organic. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSeed(): { profile: Profile; tasks: Task[]; logs: Log[]; notes: Note[] } {
  const rand = mulberry32(20260901);
  const now = new Date();
  const thresholds = { badThreshold: 1.5 };

  const profile: Profile = {
    uid: 'local-user',
    displayName: 'Alex',
    email: null,
    createdAt: new Date(now.getTime() - 21 * 86_400_000).toISOString(),
    settings: { defaultRatingThresholds: thresholds, notificationsEnabled: false },
  };

  const tasks: Task[] = SEED_TASKS.map((spec, i) => ({
    id: genId('task'),
    title: spec.title,
    category: spec.category,
    detail: spec.detail ?? null,
    expectedDurationMinutes: spec.expectedDurationMinutes,
    scheduledStart: spec.scheduledStart,
    color: spec.color,
    icon: spec.icon,
    createdAt: new Date(now.getTime() - (21 - i) * 3_600_000).toISOString(),
    archived: false,
  }));

  const logs: Log[] = [];
  const thresholds30 = { badThreshold: 1.5 };

  const dayAt = (daysAgo: number, hour: number, minute: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const mkLog = (opts: {
    task: Task;
    dayKey: string;
    startedAt: Date;
    durationSeconds: number | null;
    status: Log['status'];
    entryMode: Log['entryMode'];
    completedAt?: Date | null;
    overrideTo?: Rating;
  }): Log => {
    const expected = opts.task.expectedDurationMinutes;
    const suggested = suggestRating({
      status: opts.status,
      expectedMinutes: expected,
      actualSeconds: opts.durationSeconds,
      thresholds: thresholds30,
    });
    let rating: Rating;
    let ratingSource: Log['ratingSource'];
    if (opts.overrideTo) {
      rating = opts.overrideTo;
      ratingSource = suggested === opts.overrideTo ? 'suggested' : 'user_overridden';
    } else if (suggested) {
      rating = suggested;
      ratingSource = 'suggested';
    } else {
      rating = 'excellent';
      ratingSource = 'user_confirmed';
    }
    return {
      id: genId('log'),
      taskId: opts.task.id,
      taskTitle: opts.task.title,
      expectedMinutes: expected,
      startedAt: opts.startedAt ? opts.startedAt.toISOString() : null,
      completedAt: opts.completedAt ? opts.completedAt.toISOString() : null,
      actualDurationSeconds: opts.durationSeconds,
      rating,
      ratingSource,
      suggestedRating: suggested,
      status: opts.status,
      entryMode: opts.entryMode,
      syncedAt: new Date().toISOString(),
      dateKey: opts.dayKey,
    };
  };

  // 14 days of history, ending yesterday — today is left open for the user to try.
  for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
    const day = dayAt(daysAgo, 0, 0);
    const dayKey = dateKeyOf(day);
    const count = 3 + Math.floor(rand() * 3); // 3–5 attempts per day
    const picked = [...tasks].sort(() => rand() - 0.5).slice(0, count);

    for (const task of picked) {
      const roll = rand();
      if (roll < 0.08) {
        // Avoided entirely — "Lazy" with no timestamps (§3 design note).
        logs.push(
          mkLog({
            task,
            dayKey,
            startedAt: day,
            durationSeconds: null,
            status: 'abandoned',
            entryMode: 'tracked',
            completedAt: null,
          })
        );
        continue;
      }
      if (roll < 0.14) {
        // Backfilled after the fact (manual entry, §3.1).
        const startHour = 9 + Math.floor(rand() * 9);
        const startedAt = dayAt(daysAgo, startHour, Math.floor(rand() * 60));
        const ratio = 0.8 + rand() * 0.9;
        const durationSeconds = Math.round(task.expectedDurationMinutes * 60 * ratio);
        logs.push(
          mkLog({
            task,
            dayKey,
            startedAt,
            durationSeconds,
            status: 'completed',
            entryMode: 'manual',
            completedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
          })
        );
        continue;
      }

      // Normal live-tracked attempt. Ratio clusters near 1 with spread,
      // long tasks tend to overrun a bit more (see §9 risk note).
      const longBias = task.expectedDurationMinutes >= 60 ? 0.08 : 0;
      const ratio = Math.max(0.55, Math.min(2.4, 1 + (rand() - 0.42) * (0.5 + longBias)));
      const durationSeconds = Math.round(task.expectedDurationMinutes * 60 * ratio);
      const schedSec = task.scheduledStart
        ? Number(task.scheduledStart.slice(0, 2)) * 3600 + Number(task.scheduledStart.slice(3)) * 60
        : 10 * 3600;
      const startHour = Math.floor(schedSec / 3600);
      const startMinute = Math.floor((schedSec % 3600) / 60);
      const startedAt = dayAt(daysAgo, startHour, startMinute);
      const completedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

      // Occasionally the user is harder on themselves than the numbers (§5 analytics).
      const overrideTo: Rating | undefined =
        ratio > 1 && ratio <= 1.5 && rand() < 0.18 ? 'lazy' : undefined;

      logs.push(
        mkLog({
          task,
          dayKey,
          startedAt,
          durationSeconds,
          status: 'completed',
          entryMode: 'tracked',
          completedAt,
          overrideTo,
        })
      );
    }
  }

  // One completed log earlier today so the Today view shows life immediately.
  const todayKeyStr = dateKeyOf(now);
  const morningTask = tasks[0];
  logs.push(
    mkLog({
      task: morningTask,
      dayKey: todayKeyStr,
      startedAt: dayAt(0, 7, 4),
      durationSeconds: 13 * 60 + 40,
      status: 'completed',
      entryMode: 'tracked',
      completedAt: dayAt(0, 7, 18),
    })
  );

  // Two demo notes so the Note Taker section has life on first open —
  // one linked to the completed morning task, one standalone.
  const notes: Note[] = [
    {
      id: genId('note'),
      text: 'Stretching before coffee felt much easier than usual — keep the 7am slot.',
      taskId: morningTask.id,
      taskTitle: morningTask.title,
      taskDateKey: todayKeyStr,
      dateKey: todayKeyStr,
      createdAt: dayAt(0, 7, 24).toISOString(),
      updatedAt: dayAt(0, 7, 24).toISOString(),
    },
    {
      id: genId('note'),
      text: 'I keep underestimating the deck work — next time book two 45-minute blocks instead of one 90.',
      taskId: null,
      taskTitle: null,
      taskDateKey: null,
      dateKey: todayKeyStr,
      createdAt: dayAt(0, 8, 2).toISOString(),
      updatedAt: dayAt(0, 8, 2).toISOString(),
    },
  ];

  return { profile, tasks, logs, notes };
}
