/**
 * Shared TypeScript types — mirrors the Firestore data model (§3 of the plan).
 *
 * Firestore mapping (when the real adapter is swapped in):
 *   profile        → users/{uid}
 *   Task           → users/{uid}/tasks/{taskId}
 *   Log            → users/{uid}/logs/{logId}
 *   Note           → users/{uid}/notes/{noteId}
 *
 * In the local-first engine all documents are held in memory-mirrored
 * records and persisted to on-device storage; `syncedAt` emulates a
 * confirmed server write (it is set immediately because the local cache
 * IS the source of truth — see §4.2 of the plan).
 */

export type Rating = 'excellent' | 'bad' | 'lazy';

/** Structured-style block color key (see lib/task-style.ts). */
export type TaskColor =
  | 'coral'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'slate';

export type RatingSource = 'suggested' | 'user_confirmed' | 'user_overridden';

export type LogStatus = 'running' | 'completed' | 'abandoned';

export type EntryMode = 'tracked' | 'manual';

/** §5 — tunable per user, lives in users/{uid}.settings.defaultRatingThresholds */
export interface RatingThresholds {
  /**
   * Ratio of actual/expected above which the suggestion becomes 'lazy'
   * ("much longer than planned"). Between 1.0 and this value → 'bad'.
   */
  badThreshold: number;
}

export interface Profile {
  uid: string;
  displayName: string;
  email: string | null;
  createdAt: string; // ISO
  settings: {
    defaultRatingThresholds: RatingThresholds;
    /** When enabled, fires a web notification when a timer crosses its expected duration. */
    notificationsEnabled: boolean;
  };
  /** ISO — change clock for Firestore last-write-wins merging. */
  updatedAt?: string;
}

/** users/{uid}/tasks/{taskId} */
export interface Task {
  id: string;
  title: string;
  category: string | null;
  /** Concrete scope of the session, e.g. "Pages 110–120" or "Push-ups × 20". */
  detail?: string | null;
  expectedDurationMinutes: number;
  /** Planned time of day, "HH:mm" (24h), null when unscheduled. */
  scheduledStart: string | null;
  /** Planned day "yyyy-MM-dd" (local). null/undefined = undated — undated
   * tasks stay on Today's timeline every day until done or archived. */
  scheduledDateKey?: string | null;
  /** Visual identity on the timeline (Structured-style blocks). */
  color: TaskColor;
  /** Glyph key from lib/task-style.ts TASK_ICONS. */
  icon: string;
  createdAt: string; // ISO
  archived: boolean;
  /** ISO — change clock for Firestore last-write-wins merging. */
  updatedAt?: string;
}

/**
 * users/{uid}/logs/{logId}
 *
 * Design notes preserved from §3:
 * - `logs` is separate from `tasks`: one task can be attempted multiple
 *   times; every attempt is its own log entry.
 * - "Lazy" (avoided entirely) is representable: a log with
 *   status 'abandoned', startedAt/completedAt null.
 * - `ratingSource` preserves the reflective goal — the app only suggests;
 *   the user confirms or overrides.
 */
export interface Log {
  id: string;
  taskId: string;
  /** Denormalized snapshot so history stays readable even if a task is later archived/renamed. */
  taskTitle: string;
  /** Expected minutes at the time of the attempt (expectations change over time). */
  expectedMinutes: number;
  startedAt: string | null; // ISO; null for not-attempted abandoned logs
  completedAt: string | null; // ISO; null while running or not-attempted
  actualDurationSeconds: number | null; // computed on completion/abandon
  rating: Rating | null;
  ratingSource: RatingSource | null;
  /** Original suggestion is stored for later analytics (§5). */
  suggestedRating: Rating | null;
  status: LogStatus;
  /** 'tracked' = live timer; 'manual' = backfilled after the fact (§3.1). */
  entryMode: EntryMode;
  /** Set when the write is confirmed. Local engine: set at write time. */
  syncedAt: string | null;
  /** Local day bucket "YYYY-MM-DD" derived from startedAt (or decision day for not-attempted). */
  dateKey: string;
}

/**
 * §4.1 — timestamp-based active timer. Never store an elapsed counter;
 * elapsed is always Date.now() - startedAt, recomputed fresh on render.
 */
export interface ActiveTimer {
  logId: string;
  taskId: string;
  /** ms since epoch */
  startedAt: number;
}

/**
 * users/{uid}/notes/{noteId}
 *
 * A quick reflection captured via the Note Taker. Either standalone
 * (`taskId: null`) or linked to any task from any day — `taskTitle` is a
 * denormalized snapshot so the note stays readable even if the task is
 * later deleted or archived (same trick as Log.taskTitle).
 */
export interface Note {
  id: string;
  text: string;
  /** Linked task, or null for a standalone quick note. */
  taskId: string | null;
  taskTitle: string | null;
  /** Day bucket "YYYY-MM-DD" of the linked task (set when taskId is set). */
  taskDateKey?: string | null;
  /** Local day bucket "YYYY-MM-DD" the note was taken. */
  dateKey: string;
  createdAt: string; // ISO
  /** ISO — change clock for Firestore last-write-wins merging. */
  updatedAt?: string;
}

export type TabId = 'today' | 'week' | 'overview' | 'history' | 'settings';

/** Input shape for the Note Taker (see store.addNote). */
export interface NoteInput {
  text: string;
  /** Task the note is attached to — any task, today or another day. null = standalone. */
  taskId?: string | null;
  /** Day the linked task belongs to; defaults to today when linking. */
  taskDateKey?: string | null;
}

/** Input shape for creating a log via manual backfill (§3.1). */
export interface ManualLogInput {
  taskId: string;
  /** ISO */
  startedAt: string;
  durationSeconds: number;
}
