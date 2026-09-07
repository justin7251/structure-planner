/**
 * Review client — everything around the provider call (plan §6.1):
 * enablement, daily cap, content-hash cache, linked-task context, and
 * persistence into the aiReviews store slice.
 *
 * The UI never talks to the provider directly and never sees the key's
 * storage details. The key lives in its own localStorage entry that no
 * store serialization touches, so no code path — not persistence, not
 * export, not the sync engine — can copy it into the Firestore mirror
 * (plan §6.2).
 */

import { useAppStore } from '@/store/use-app-store';
import type { Log } from '@/types';
import {
  AiReview,
  ReviewError,
  ReviewPayload,
  callReviewModel,
  hashNoteText,
} from '@/lib/ai/provider';

/** Daily cap, checked before any provider call (plan §6.3). */
export const DAILY_REVIEW_CAP = 20;

/** Reviews kept per device — oldest are garbage-collected (plan §6.2). */
const MAX_STORED_REVIEWS = 200;

const KEY_STORAGE = 'structure-planner:ai:key';
const USAGE_STORAGE = 'structure-planner:ai:usage';

// ── key custody (device-local, outside the synced store) ───────────────

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

/** Masked form for the Settings row — never expose more than the tail. */
export function describeApiKey(): string | null {
  const key = getApiKey();
  if (!key) return null;
  const tail = key.slice(-4);
  return `••••${tail}`;
}

// ── daily usage cap ─────────────────────────────────────────────────────

interface DailyUsage {
  dateKey: string;
  count: number;
}

function readUsage(): DailyUsage {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyUsage;
      if (parsed && parsed.dateKey === todayKeyLocal()) return parsed;
    }
  } catch {
    // corrupted record — treat as a fresh day
  }
  return { dateKey: todayKeyLocal(), count: 0 };
}

function bumpUsage(): void {
  const usage = readUsage();
  localStorage.setItem(
    USAGE_STORAGE,
    JSON.stringify({ dateKey: usage.dateKey, count: usage.count + 1 }),
  );
}

/** Reviews used today — for the Settings usage line (non-reactive read). */
export function getUsageToday(): number {
  return readUsage().count;
}

function todayKeyLocal(): string {
  // Local "YYYY-MM-DD" without importing the app's date helpers keeps this
  // module dependency-light; the format matches lib/format's dateKeyOf.
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── the review request ──────────────────────────────────────────────────

/** What a review needs. `noteId` present = saved-note review (cached and
 *  persisted); absent = pre-save draft review (ephemeral — a draft has no
 *  stable identity to key a cache or a store entry by, plan §4.1/§6.2). */
export interface ReviewRequestInput {
  text: string;
  taskId: string | null;
  /** Local day of the note — the linked task's day, or today for quick notes. */
  dateKey: string;
  noteId?: string;
}

export interface ReviewOutcome {
  review: AiReview;
  /** true = served from the local content-hash cache at zero cost. */
  cached: boolean;
}

/**
 * Run the full review pipeline for one note or draft (plan §6.1 order):
 * enablement → online → cap → cache (saved notes) → provider call →
 * validation → persist (saved notes). Throws ReviewError with a
 * UI-mappable code; never persists a partial result.
 */
export async function requestReview(input: ReviewRequestInput): Promise<ReviewOutcome> {
  const state = useAppStore.getState();

  if (!state.aiEnabled) throw new ReviewError('config', 'AI review is not enabled.');
  const apiKey = getApiKey();
  if (!apiKey) throw new ReviewError('config', 'No API key configured.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ReviewError('network', 'Review needs a connection. Your note is saved locally.');
  }
  const usage = readUsage();
  if (usage.count >= DAILY_REVIEW_CAP) {
    throw new ReviewError('provider', "That is today's reviews. Back tomorrow.");
  }

  // Cache lookup — a matching content hash reopens instantly at no cost.
  // Saved-note reviews only: a draft re-review after edits is an honest
  // new call, because the draft has no persisted review to match against.
  const contentHash = await hashNoteText(input.text);
  const existing = input.noteId ? state.aiReviews[input.noteId] : undefined;
  if (input.noteId && existing && existing.contentHash === contentHash) {
    return { review: existing, cached: true };
  }

  // Linked-task context, read as-is from the store — for old notes the
  // values may be stale; the prompt treats them as historical context.
  const linkedTask = buildLinkedTaskContext(input.taskId, input.dateKey);

  const payload: ReviewPayload = {
    noteText: input.text,
    noteDateKey: input.dateKey,
    linkedTask,
    locale: 'en',
  };

  const { cards, model, promptVersion } = await callReviewModel(payload, apiKey);

  const review: AiReview = {
    noteId: input.noteId ?? '',
    cards,
    model,
    promptVersion,
    createdAt: new Date().toISOString(),
    contentHash,
    drafts: {},
    answersSavedAt: null,
  };

  // Persist only when there is a note to persist against; draft reviews
  // live in the review sheet's component state and die with it.
  if (input.noteId) state.saveAiReview(review);
  bumpUsage();
  return { review, cached: false };
}

function buildLinkedTaskContext(
  taskId: string | null,
  dateKey: string | null,
): ReviewPayload['linkedTask'] {
  if (!taskId) return null;
  const state = useAppStore.getState();
  const task = state.tasks[taskId];
  if (!task) return null;

  // The latest log for that task on the note's day carries status + actual.
  // Explicit `Log | null` — an untyped `null` initializer narrows every
  // later access to `never` and the assignment itself to a type error.
  let latest: Log | null = null;
  for (const log of Object.values(state.logs)) {
    if (log.taskId !== taskId) continue;
    if (dateKey && log.dateKey !== dateKey) continue;
    const stamp = log.completedAt ?? log.startedAt ?? '';
    const prevStamp = latest ? latest.completedAt ?? latest.startedAt ?? '' : '';
    if (!latest || stamp > prevStamp) latest = log;
  }

  return {
    title: task.title,
    status: latest?.status ?? null,
    expectedMinutes: task.expectedDurationMinutes,
    actualMinutes:
      latest?.actualDurationSeconds != null ? Math.round(latest.actualDurationSeconds / 60) : null,
  };
}
