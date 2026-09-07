import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { genId } from '@/lib/id';
import { dateKeyOf, todayKey } from '@/lib/format';
import { suggestRating } from '@/lib/rating/suggestRating';
import { elapsedSeconds } from '@/lib/timer/engine';
import { writeActiveTimer, writeLogUpdate, writeNewLog } from '@/lib/timer/firestoreWriters';
import { buildSeed } from '@/lib/seed';
import { defaultColorForIndex, defaultIconForIndex } from '@/lib/task-style';
import { haptics } from '@/lib/haptics';
import { notifications } from '@/lib/notifications';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/use-auth-store';
import type { AuthUser } from '@/lib/firebase/auth';
import type {
  ActiveTimer,
  Log,
  ManualLogInput,
  Note,
  NoteInput,
  Profile,
  Rating,
  RatingThresholds,
  TabId,
  Task,
  TaskColor,
} from '@/types';
import type { AiReview, ReviewAnswerBlock, ReviewFixEdit } from '@/lib/ai/provider';
import { applyFixToText, formatAnswerBlocks } from '@/lib/ai/provider';

/**
 * Client state (Zustand) — the local-first source of truth.
 *
 * `tasks` / `logs` mirror the Firestore subcollections; `activeTimer` is
 * the §4.2 Zustand mirror of the running log so the UI reacts instantly
 * without waiting on a snapshot round-trip. Everything except UI flags is
 * persisted to on-device storage, so a running timer survives refreshes
 * and app kills (§4.4 recovery additionally reconciles on load).
 */

function defaultProfile(): Profile {
  return {
    uid: 'local-user',
    displayName: 'You',
    email: null,
    createdAt: new Date().toISOString(),
    settings: { defaultRatingThresholds: { badThreshold: 1.5 }, notificationsEnabled: false },
  };
}

export interface TaskInput {
  title: string;
  category: string | null;
  /** Optional concrete scope, e.g. "Pages 110–120" / "Push-ups × 20". */
  detail?: string | null;
  /** "yyyy-MM-dd" — the day this plan belongs to; null = undated (today-timeline). */
  scheduledDateKey?: string | null;
  expectedDurationMinutes: number;
  scheduledStart: string | null;
  color?: TaskColor;
  icon?: string;
}

/** NoteInput lives in @/types; TaskInput (below) is the store's task form shape. */

/** Which cloud collection a tombstone refers to. */
export type DeleteKind = 'tasks' | 'logs' | 'notes';

/** Durable deletion record. Deleting is invisible to queries — Firestore can
 *  never tell another device "this doc is gone" — so deletions travel as
 *  tombstones: kept locally until the cloud confirms, mirrored into the
 *  `deletions` subcollection so every device drops the same doc. Without
 *  this, any stale session re-pushes the doc and deleted tasks resurrect. */
export interface PendingDelete {
  kind: DeleteKind;
  id: string;
  /** Deletion clock — doubles as the LWW tiebreaker vs. a newer local edit. */
  deletedAt: string;
}

/** Tombstone map key: `${kind}:${id}`. */
export function pendingDeleteKey(kind: DeleteKind, id: string): string {
  return `${kind}:${id}`;
}

interface AppState {
  // ── persisted ────────────────────────────────────────────────
  profile: Profile;
  /** Uid whose data the local store currently mirrors (account-switch guard).
   *  null = no signed-in account has claimed this device's data yet. */
  dataOwnerUid: string | null;
  tasks: Record<string, Task>;
  logs: Record<string, Log>;
  /** Quick notes from the Note Taker (standalone or linked to any task). */
  notes: Record<string, Note>;
  /** AI reviews, keyed by note id. Device-local by design — EXCLUDED from
   *  the Firestore mirror (zero sync-engine surface, plan §6.2). */
  aiReviews: Record<string, AiReview>;
  /** AI note review opt-in (plan P5). The API key itself is NOT stored here —
   *  it lives in its own localStorage entry no serialization touches. */
  aiEnabled: boolean;
  /** Tombstones awaiting cloud confirmation — persisted, survives restarts. */
  pendingDeletes: Record<string, PendingDelete>;
  activeTimer: ActiveTimer | null;
  seededAt: string | null;
  /** False until the visitor opened the app (landing page gate). */
  hasEnteredApp: boolean;

  // ── ephemeral UI ─────────────────────────────────────────────
  activeTab: TabId;
  /** Log awaiting its reflective rating moment. */
  ratingSheetLogId: string | null;
  taskFormOpen: boolean;
  editingTaskId: string | null;
  manualTimeOpen: boolean;
  /** Task pre-selected for the manual-time sheet. */
  manualTimeTaskId: string | null;
  /** Task context sheet (Structured-style long-press/tap actions). */
  taskActionsOpen: boolean;
  actionsTaskId: string | null;
  /** "HH:mm" prefill for a fresh task form (tap an empty timeline slot). */
  taskFormPrefill: string | null;
  /** "yyyy-MM-dd" day prefill for a fresh task form (plan from Overview). */
  taskFormDatePrefill: string | null;
  /** Note Taker capture sheet. */
  noteTakerOpen: boolean;
  /** Task pre-linked for the note being written (opened from a task's action sheet). */
  noteTakerTaskId: string | null;
  /** Selected day ("YYYY-MM-DD") in the Overview tab. */
  overviewDateKey: string;
  isFirstRun: boolean;

  // ── recovery (§4.4) ──────────────────────────────────────────
  reconcile: () => void;
  ensureSeeded: () => void;

  // ── task CRUD ────────────────────────────────────────────────
  addTask: (input: TaskInput) => Task;
  updateTask: (taskId: string, patch: Partial<TaskInput>) => void;
  archiveTask: (taskId: string) => void;
  restoreTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  /** Sync bookkeeping: drop tombstones the cloud has confirmed. */
  clearPendingDeletes: (keys: string[]) => void;

  // ── timer flows (§4.2 / §4.3) ────────────────────────────────
  startTimer: (taskId: string) => boolean;
  stopTimer: () => void;
  abandonRunning: () => void;
  markNotDone: (taskId: string) => void;
  /** Quick-complete: done today without timing — actual stays null, so no fake ratio. */
  markCompleteToday: (taskId: string) => boolean;

  // ── manual backfill (§3.1) ───────────────────────────────────
  addManualLog: (input: ManualLogInput) => { log: Log; merged: boolean };

  // ── note taker ───────────────────────────────────────────────
  addNote: (input: NoteInput) => Note;
  deleteNote: (noteId: string) => void;

  // ── AI review (plan §6.2 — device-local slice) ────────
  setAiEnabled: (enabled: boolean) => void;
  /** Persist a validated review (or a draft/answer update to one). */
  saveAiReview: (review: AiReview) => void;
  /** Draft autosave — quiet and reversible (plan P4). */
  updateAiReviewDraft: (noteId: string, cardIndex: number, text: string) => void;
  /** Final-card Save: append answers to the note in one atomic write,
   *  each marked "added from review", then clear the drafts. */
  saveReviewAnswers: (
    noteId: string,
    blocks: ReviewAnswerBlock[],
  ) => void;
  /** User-approved fixes land here: each replaces the FIRST occurrence of
   *  its find string in the stored note (skipped when the spot is gone),
   *  and the card is stamped in the review's appliedFixes. One atomic
   *  write for the whole batch. Draft-mode applies never come through the
   *  store — a draft has nothing to persist against (plan §4.1). */
  applyReviewFixesToNote: (noteId: string, edits: ReviewFixEdit[]) => void;

  // ── rating (§5) ──────────────────────────────────────────────
  confirmRating: (logId: string, rating: Rating) => void;
  openRatingSheet: (logId: string) => void;
  closeRatingSheet: () => void;

  // ── settings ─────────────────────────────────────────────────
  updateProfile: (patch: Partial<Pick<Profile, 'displayName'>>) => void;
  updateThresholds: (patch: Partial<RatingThresholds>) => void;
  setNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  /** Adopt the signed-in Google identity into the local profile (uid/email/name-if-default). */
  adoptAuthUser: (user: AuthUser) => void;
  /** Account-switch guard — MUST run before the Firestore mirror starts for a
   *  user. Wipes local data when it belongs to a different account. */
  claimDataOwner: (user: AuthUser) => void;
  // ── landing gate ───────────────────────────────────────────
  enterApp: () => void;
  exitToLanding: () => void;
  setActiveTab: (tab: TabId) => void;
  openTaskForm: (taskId?: string, prefillStart?: string | null, prefillDateKey?: string | null) => void;
  closeTaskForm: () => void;
  openManualTime: (taskId?: string) => void;
  closeManualTime: () => void;
  openNoteTaker: (prefillTaskId?: string | null) => void;
  closeNoteTaker: () => void;
  openTaskActions: (taskId: string) => void;
  closeTaskActions: () => void;
  setOverviewDate: (key: string) => void;
  dismissFirstRun: () => void;

  // ── data management ──────────────────────────────────────────
  loadDemoData: () => void;
  resetAll: () => void;
}

function buildLog(opts: {
  profile: Profile;
  task: Task;
  status: Log['status'];
  entryMode: Log['entryMode'];
  startedAt: Date | null;
  completedAt: Date | null;
  actualDurationSeconds: number | null;
  dayKey: string;
}): Log {
  const suggested = suggestRating({
    status: opts.status,
    expectedMinutes: opts.task.expectedDurationMinutes,
    actualSeconds: opts.actualDurationSeconds,
    thresholds: opts.profile.settings.defaultRatingThresholds,
  });
  return {
    id: genId('log'),
    taskId: opts.task.id,
    taskTitle: opts.task.title,
    expectedMinutes: opts.task.expectedDurationMinutes,
    startedAt: opts.startedAt ? opts.startedAt.toISOString() : null,
    completedAt: opts.completedAt ? opts.completedAt.toISOString() : null,
    actualDurationSeconds: opts.actualDurationSeconds,
    rating: null,
    ratingSource: null,
    suggestedRating: suggested,
    status: opts.status,
    entryMode: opts.entryMode,
    syncedAt: new Date().toISOString(), // local engine: write confirmed immediately
    dateKey: opts.dayKey,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      profile: defaultProfile(),
      dataOwnerUid: null,
      tasks: {},
      logs: {},
      notes: {},
      aiReviews: {},
      aiEnabled: false,
      pendingDeletes: {},
      activeTimer: null,
      seededAt: null,
      hasEnteredApp: false,

      activeTab: 'today',
      ratingSheetLogId: null,
      taskFormOpen: false,
      editingTaskId: null,
      manualTimeOpen: false,
      manualTimeTaskId: null,
      taskActionsOpen: false,
      actionsTaskId: null,
      taskFormPrefill: null,
      taskFormDatePrefill: null,
      noteTakerOpen: false,
      noteTakerTaskId: null,
      overviewDateKey: todayKey(),
      isFirstRun: false,

      // ── §4.4 recovery ─────────────────────────────────────────
      reconcile: () => {
        const state = get();
        const runningLog = Object.values(state.logs).find((l) => l.status === 'running');

        if (state.activeTimer) {
          const log = state.logs[state.activeTimer.logId];
          if (!log || log.status !== 'running') {
            // Timer mirror points at a finished/missing log — clear it.
            writeActiveTimer(null);
          }
          return;
        }
        if (runningLog) {
          // App was killed while a timer ran — restore from the log doc
          // (served from the persisted cache when offline).
          writeActiveTimer({
            logId: runningLog.id,
            taskId: runningLog.taskId,
            startedAt: runningLog.startedAt ? Date.parse(runningLog.startedAt) : Date.now(),
          });
        }
      },

      ensureSeeded: () => {
        const state = get();
        if (state.seededAt || Object.keys(state.tasks).length > 0) return;
        // Signed-in users (or a session being restored) start from their
        // cloud data — never pollute a fresh account with demo content.
        const authStatus = isFirebaseConfigured ? useAuthStore.getState().status : 'signedOut';
        if (authStatus !== 'signedOut') return;
        const seed = buildSeed();
        set({
          profile: seed.profile,
          tasks: Object.fromEntries(seed.tasks.map((t) => [t.id, t])),
          logs: Object.fromEntries(seed.logs.map((l) => [l.id, l])),
          notes: Object.fromEntries(seed.notes.map((n) => [n.id, n])),
          seededAt: new Date().toISOString(),
          isFirstRun: true,
        });
        get().reconcile();
      },

      // ── task CRUD ─────────────────────────────────────────────
      addTask: (input) => {
        const state = get();
        const index = Object.keys(state.tasks).length;
        const task: Task = {
          id: genId('task'),
          title: input.title.trim(),
          category: input.category?.trim() || null,
          detail: input.detail?.trim() || null,
          expectedDurationMinutes: input.expectedDurationMinutes,
          scheduledStart: input.scheduledStart,
          scheduledDateKey: input.scheduledDateKey ?? null,
          color: input.color ?? defaultColorForIndex(index),
          icon: input.icon ?? defaultIconForIndex(index),
          createdAt: new Date().toISOString(),
          archived: false,
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
        haptics.light();
        return task;
      },

      updateTask: (taskId, patch) => {
        set((s) => {
          const task = s.tasks[taskId];
          if (!task) return s;
          return {
            tasks: {
              ...s.tasks,
              [taskId]: {
                ...task,
                ...patch,
                title: patch.title !== undefined ? patch.title.trim() : task.title,
                category: patch.category !== undefined ? patch.category?.trim() || null : task.category,
                detail: patch.detail !== undefined ? patch.detail?.trim() || null : task.detail,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      archiveTask: (taskId) => {
        const { activeTimer } = get();
        if (activeTimer?.taskId === taskId) return; // guarded in UI with a toast
        set((s) => {
          const task = s.tasks[taskId];
          if (!task) return s;
          return { tasks: { ...s.tasks, [taskId]: { ...task, archived: true, updatedAt: new Date().toISOString() } } };
        });
      },

      restoreTask: (taskId) => {
        set((s) => {
          const task = s.tasks[taskId];
          if (!task) return s;
          return { tasks: { ...s.tasks, [taskId]: { ...task, archived: false, updatedAt: new Date().toISOString() } } };
        });
      },

      deleteTask: (taskId) => {
        const { activeTimer } = get();
        if (activeTimer?.taskId === taskId) return;
        set((s) => {
          const tasks = { ...s.tasks };
          delete tasks[taskId];
          return {
            tasks,
            pendingDeletes: {
              ...s.pendingDeletes,
              [pendingDeleteKey('tasks', taskId)]: {
                kind: 'tasks',
                id: taskId,
                deletedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      clearPendingDeletes: (keys) => {
        if (keys.length === 0) return;
        set((s) => {
          const pendingDeletes = { ...s.pendingDeletes };
          for (const key of keys) delete pendingDeletes[key];
          return { pendingDeletes };
        });
      },

      // ── timer flows ───────────────────────────────────────────
      /** §4.2 write path. Returns false when a timer is already running (§9 conflict rule). */
      startTimer: (taskId) => {
        const state = get();
        if (state.activeTimer) return false;

        // Conflict check: reject a start if a running log already exists once synced.
        const runningLog = Object.values(state.logs).find((l) => l.status === 'running');
        if (runningLog) {
          writeActiveTimer({
            logId: runningLog.id,
            taskId: runningLog.taskId,
            startedAt: runningLog.startedAt ? Date.parse(runningLog.startedAt) : Date.now(),
          });
          return false;
        }

        const task = state.tasks[taskId];
        if (!task) return false;

        const now = new Date();
        const log = buildLog({
          profile: state.profile,
          task,
          status: 'running',
          entryMode: 'tracked',
          startedAt: now,
          completedAt: null,
          actualDurationSeconds: null,
          dayKey: dateKeyOf(now),
        });

        writeNewLog(log);
        // Mirror into Zustand for instant, reactive UI (§4.2).
        writeActiveTimer({ logId: log.id, taskId, startedAt: now.getTime() });
        haptics.light();
        return true;
      },

      /** §4.3 — compute duration from timestamps, open the reflective rating moment. */
      stopTimer: () => {
        const state = get();
        const timer = state.activeTimer;
        if (!timer) return;
        const log = state.logs[timer.logId];
        const task = state.tasks[timer.taskId];
        if (!log || !task) {
          writeActiveTimer(null);
          return;
        }

        const now = new Date();
        const actualDurationSeconds = elapsedSeconds(timer.startedAt);
        const suggested = suggestRating({
          status: 'completed',
          expectedMinutes: task.expectedDurationMinutes,
          actualSeconds: actualDurationSeconds,
          thresholds: state.profile.settings.defaultRatingThresholds,
        });

        writeLogUpdate(timer.logId, {
          status: 'completed',
          completedAt: now.toISOString(),
          actualDurationSeconds,
          suggestedRating: suggested,
        });
        writeActiveTimer(null);
        haptics.success();
        set({ ratingSheetLogId: timer.logId });
      },

      /** Gave up partway — log becomes 'abandoned' with real elapsed time; suggests 'lazy'. */
      abandonRunning: () => {
        const state = get();
        const timer = state.activeTimer;
        if (!timer) return;
        const log = state.logs[timer.logId];
        if (!log) {
          writeActiveTimer(null);
          return;
        }

        const now = new Date();
        const actualDurationSeconds = elapsedSeconds(timer.startedAt);
        writeLogUpdate(timer.logId, {
          status: 'abandoned',
          completedAt: now.toISOString(),
          actualDurationSeconds,
          suggestedRating: 'lazy',
        });
        writeActiveTimer(null);
        haptics.warning();
        set({ ratingSheetLogId: timer.logId });
      },

      /** Avoided entirely — a log with status 'abandoned' and no timestamps (§3 design note). */
      markNotDone: (taskId) => {
        const state = get();
        if (state.activeTimer?.taskId === taskId) return;
        const task = state.tasks[taskId];
        if (!task) return;
        const now = new Date();
        const log = buildLog({
          profile: state.profile,
          task,
          status: 'abandoned',
          entryMode: 'tracked',
          startedAt: null,
          completedAt: null,
          actualDurationSeconds: null,
          dayKey: dateKeyOf(now),
        });
        writeNewLog(log);
        haptics.warning();
        set({ ratingSheetLogId: log.id });
      },

      /** Quick-complete — done, but untimed. actualDurationSeconds stays null so no
       *  dishonest ratio is invented (§5 yields no suggestion for unmeasured work);
       *  the session can still be rated later from History. */
      markCompleteToday: (taskId) => {
        const state = get();
        if (state.activeTimer?.taskId === taskId) return false;
        const task = state.tasks[taskId];
        if (!task) return false;
        const key = dateKeyOf(new Date());
        const alreadyDone = Object.values(state.logs).some(
          (l) => l.taskId === taskId && l.dateKey === key && l.status === 'completed',
        );
        if (alreadyDone) return false;
        const now = new Date();
        const log = buildLog({
          profile: state.profile,
          task,
          status: 'completed',
          entryMode: 'manual',
          startedAt: now,
          completedAt: now,
          actualDurationSeconds: null,
          dayKey: key,
        });
        writeNewLog(log);
        haptics.success();
        return true;
      },

      // ── note taker ────────────────────────────────────────────
      addNote: (input) => {
        const state = get();
        const text = input.text.trim();
        if (!text) {
          // Guarded in the UI (save button disabled) — never persisted.
          throw new Error('Note text is empty');
        }
        const task = input.taskId ? state.tasks[input.taskId] : undefined;
        const nowIso = new Date().toISOString();
        const note: Note = {
          id: genId('note'),
          text,
          taskId: task?.id ?? null,
          // Denormalized snapshot — the note stays readable even if the
          // task is later deleted or archived (same trick as Log.taskTitle).
          taskTitle: task?.title ?? null,
          // Which day the linked task belongs to (the picker's date when linking).
          taskDateKey: task ? (input.taskDateKey ?? todayKey()) : null,
          dateKey: todayKey(),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        set((s) => ({ notes: { ...s.notes, [note.id]: note } }));
        haptics.light();
        return note;
      },

      deleteNote: (noteId) => {
        set((s) => {
          const notes = { ...s.notes };
          delete notes[noteId];
          // Orphan GC — the review is device-local, nothing to tombstone.
          const aiReviews = { ...s.aiReviews };
          delete aiReviews[noteId];
          return {
            notes,
            aiReviews,
            pendingDeletes: {
              ...s.pendingDeletes,
              [pendingDeleteKey('notes', noteId)]: {
                kind: 'notes',
                id: noteId,
                deletedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      // ── AI review slice (device-local, plan §6.2) ───────────
      setAiEnabled: (enabled) => set({ aiEnabled: enabled }),

      saveAiReview: (review) =>
        set((s) => {
          const aiReviews = { ...s.aiReviews, [review.noteId]: review };
          // Bound the slice: keep the most recent 200 (plan §6.2).
          const ids = Object.keys(aiReviews);
          if (ids.length > 200) {
            ids
              .sort((a, b) => aiReviews[a].createdAt.localeCompare(aiReviews[b].createdAt))
              .slice(0, ids.length - 200)
              .forEach((id) => delete aiReviews[id]);
          }
          return { aiReviews };
        }),

      updateAiReviewDraft: (noteId, cardIndex, text) =>
        set((s) => {
          const review = s.aiReviews[noteId];
          if (!review) return s;
          const drafts = { ...review.drafts };
          if (text.trim()) drafts[cardIndex] = text;
          else delete drafts[cardIndex];
          return { aiReviews: { ...s.aiReviews, [noteId]: { ...review, drafts } } };
        }),

      saveReviewAnswers: (noteId, blocks) =>
        set((s) => {
          const note = s.notes[noteId];
          const review = s.aiReviews[noteId];
          if (!note || blocks.length === 0) return s;
          // Answers join the note as the user's own text, each marked so
          // provenance stays honest (plan §4.2). One atomic write; the
          // format is shared with the pre-save draft append.
          const addition = formatAnswerBlocks(blocks);
          const nowIso = new Date().toISOString();
          return {
            notes: {
              ...s.notes,
              [noteId]: { ...note, text: `${note.text}\n\n${addition}`, updatedAt: nowIso },
            },
            aiReviews: review
              ? {
                  ...s.aiReviews,
                  [noteId]: { ...review, drafts: {}, answersSavedAt: nowIso },
                }
              : s.aiReviews,
          };
        }),

      applyReviewFixesToNote: (noteId, edits) =>
        set((s) => {
          const note = s.notes[noteId];
          if (!note || edits.length === 0) return s;
          // Apply in card order, chaining on the evolving text — fixes were
          // validated against the same text the user is looking at, but a
          // spot can disappear (edited away, covered by an earlier fix in
          // this batch); a vanished spot is skipped, never re-anchored.
          let text = note.text;
          const nowIso = new Date().toISOString();
          const applied: Record<number, string> = {};
          for (const edit of edits) {
            const next = applyFixToText(text, edit.find, edit.replaceWith);
            if (next === null) continue;
            text = next;
            applied[edit.cardIndex] = nowIso;
          }
          if (Object.keys(applied).length === 0) return s;
          const review = s.aiReviews[noteId];
          return {
            notes: {
              ...s.notes,
              [noteId]: { ...note, text, updatedAt: nowIso },
            },
            aiReviews: review
              ? {
                  ...s.aiReviews,
                  [noteId]: {
                    ...review,
                    appliedFixes: { ...review.appliedFixes, ...applied },
                  },
                }
              : s.aiReviews,
          };
        }),

      // ── §3.1 manual backfill ──────────────────────────────────
      addManualLog: (input) => {
        const state = get();
        const task = state.tasks[input.taskId];
        const startedAtDate = new Date(input.startedAt);
        // Round BEFORE deriving completedAt, so the stored start/end pair and
        // the stored duration always describe the same session.
        const durationSeconds = Math.max(1, Math.round(input.durationSeconds));
        const completedAt = new Date(startedAtDate.getTime() + durationSeconds * 1000);
        const dayKey = dateKeyOf(startedAtDate);

        // One real session must never become two log rows. If the same task
        // already has a same-day placeholder entry, absorb the backfilled
        // time into it instead of appending a duplicate:
        //   1) an untimed "Complete" check-in  → gains its actual time;
        //   2) a "Didn't do it" skip           → converted: time says otherwise.
        // A same-day *timed* session is untouched — that can be a legitimate
        // second attempt (the sheet warns before adding another one).
        const sameDay = Object.values(state.logs).filter(
          (l) => l.taskId === input.taskId && l.dateKey === dayKey,
        );
        const newerFirst = (a: Log, b: Log) =>
          (b.completedAt ?? b.startedAt ?? '').localeCompare(a.completedAt ?? a.startedAt ?? '');
        const target =
          sameDay
            .filter((l) => l.status === 'completed' && l.actualDurationSeconds == null)
            .sort(newerFirst)[0] ??
          sameDay.filter((l) => l.status === 'abandoned' && l.startedAt == null).sort(newerFirst)[0];

        if (task && target) {
          const suggested = suggestRating({
            status: 'completed',
            expectedMinutes: task.expectedDurationMinutes,
            actualSeconds: durationSeconds,
            thresholds: state.profile.settings.defaultRatingThresholds,
          });
          writeLogUpdate(target.id, {
            status: 'completed',
            entryMode: 'manual',
            startedAt: startedAtDate.toISOString(),
            completedAt: completedAt.toISOString(),
            actualDurationSeconds: durationSeconds,
            suggestedRating: suggested,
          });
          haptics.light();
          set({ ratingSheetLogId: target.id });
          return { log: get().logs[target.id], merged: true };
        }

        const log = buildLog({
          profile: state.profile,
          task,
          status: 'completed',
          entryMode: 'manual',
          startedAt: startedAtDate,
          completedAt,
          actualDurationSeconds: durationSeconds,
          dayKey,
        });
        writeNewLog(log);
        haptics.light();
        set({ ratingSheetLogId: log.id });
        return { log, merged: false };
      },

      // ── §5 reflective rating ──────────────────────────────────
      confirmRating: (logId, rating) => {
        const state = get();
        const log = state.logs[logId];
        if (!log) return;
        const source: Log['ratingSource'] =
          log.suggestedRating == null
            ? 'user_confirmed'
            : log.suggestedRating === rating
              ? 'suggested'
              : 'user_overridden';
        writeLogUpdate(logId, { rating, ratingSource: source });
        haptics.success();
      },

      openRatingSheet: (logId) => set({ ratingSheetLogId: logId }),
      closeRatingSheet: () => set({ ratingSheetLogId: null }),

      // ── settings ──────────────────────────────────────────────
      updateProfile: (patch) =>
        set((s) => ({
          profile: { ...s.profile, ...patch, updatedAt: new Date().toISOString() },
        })),

      updateThresholds: (patch) =>
        set((s) => ({
          profile: {
            ...s.profile,
            updatedAt: new Date().toISOString(),
            settings: {
              ...s.profile.settings,
              defaultRatingThresholds: {
                ...s.profile.settings.defaultRatingThresholds,
                ...patch,
              },
            },
          },
        })),

      setNotificationsEnabled: async (enabled) => {
        if (!enabled) {
          set((s) => ({
            profile: {
              ...s.profile,
              updatedAt: new Date().toISOString(),
              settings: { ...s.profile.settings, notificationsEnabled: false },
            },
          }));
          return true;
        }
        const granted = await notifications.requestPermission();
        set((s) => ({
          profile: {
            ...s.profile,
            updatedAt: new Date().toISOString(),
            settings: { ...s.profile.settings, notificationsEnabled: granted },
          },
        }));
        return granted;
      },

      adoptAuthUser: (user) =>
        set((s) => {
          if (s.profile.uid === user.uid && s.profile.email === (user.email ?? null)) return {};
          const wasDefaultName = !s.profile.displayName || s.profile.displayName === 'You';
          return {
            profile: {
              ...s.profile,
              uid: user.uid,
              email: user.email ?? s.profile.email,
              displayName: wasDefaultName
                ? user.displayName || s.profile.displayName
                : s.profile.displayName,
              updatedAt: new Date().toISOString(),
            },
          };
        }),

      /**
       * Account-switch guard. The persisted store holds exactly one account's
       * data. When a DIFFERENT account signs in on this device, wipe the data
       * domain first — otherwise the first-of-session upload pass would push
       * the previous user's tasks/logs/notes into the new user's cloud tree
       * (and the UI would blend both accounts). A first-ever sign-in (null)
       * ADOPTS the local data instead — that is the local-first upload flow.
       *
       * On a switch the profile is seeded straight from the Google identity
       * (NO updatedAt stamp), so adoptAuthUser becomes a no-op afterwards and
       * the account's own cloud profile wins the LWW merge when the mirror
       * attaches. Call before startFirestoreSync so no subscription observes
       * the wipe.
       */
      claimDataOwner: (user) =>
        set((s) => {
          if (s.dataOwnerUid === user.uid) return {};
          const firstClaim = s.dataOwnerUid === null;
          return {
            dataOwnerUid: user.uid,
            ...(firstClaim
              ? {}
              : {
                  profile: {
                    ...defaultProfile(),
                    uid: user.uid,
                    email: user.email ?? null,
                    displayName: user.displayName || 'You',
                  },
                  tasks: {},
                  logs: {},
                  notes: {},
                  aiReviews: {},
                  pendingDeletes: {},
                  activeTimer: null,
                  seededAt: null,
                }),
          };
        }),

      // ── landing gate ──────────────────────────────────────────
      enterApp: () => set({ hasEnteredApp: true }),
      exitToLanding: () => set({ hasEnteredApp: false }),

      setActiveTab: (tab) => set({ activeTab: tab }),
      openTaskForm: (taskId, prefillStart, prefillDateKey) =>
        set({
          taskFormOpen: true,
          editingTaskId: taskId ?? null,
          taskFormPrefill: prefillStart ?? null,
          taskFormDatePrefill: prefillDateKey ?? null,
        }),
      closeTaskForm: () =>
        set({ taskFormOpen: false, editingTaskId: null, taskFormPrefill: null, taskFormDatePrefill: null }),
      openManualTime: (taskId) => set({ manualTimeOpen: true, manualTimeTaskId: taskId ?? null }),
      closeManualTime: () => set({ manualTimeOpen: false, manualTimeTaskId: null }),
      openNoteTaker: (prefillTaskId) =>
        set({ noteTakerOpen: true, noteTakerTaskId: prefillTaskId ?? null }),
      closeNoteTaker: () => set({ noteTakerOpen: false, noteTakerTaskId: null }),
      openTaskActions: (taskId) => set({ taskActionsOpen: true, actionsTaskId: taskId }),
      closeTaskActions: () => set({ taskActionsOpen: false, actionsTaskId: null }),
      setOverviewDate: (key) => set({ overviewDateKey: key }),
      dismissFirstRun: () => set({ isFirstRun: false }),

      // ── data management ───────────────────────────────────────
      loadDemoData: () => {
        const seed = buildSeed();
        set({
          profile: seed.profile,
          tasks: Object.fromEntries(seed.tasks.map((t) => [t.id, t])),
          logs: Object.fromEntries(seed.logs.map((l) => [l.id, l])),
          notes: Object.fromEntries(seed.notes.map((n) => [n.id, n])),
          activeTimer: null,
          ratingSheetLogId: null,
          seededAt: new Date().toISOString(),
          overviewDateKey: todayKey(),
        });
      },

      resetAll: () => {
        set({
          profile: defaultProfile(),
          tasks: {},
          logs: {},
          notes: {},
          aiReviews: {},
          aiEnabled: false,
          pendingDeletes: {},
          activeTimer: null,
          seededAt: new Date().toISOString(),
          ratingSheetLogId: null,
          isFirstRun: false,
        });
      },
    }),
    {
      name: 'structure-planner-v1',
      version: 5,
      storage: createJSONStorage(() => localStorage),
      // v1 → v2: tasks gain Structured-style color/icon; rotate defaults
      // over the stored order so existing plans get a coherent look.
      // v2 → v3: landing gate — existing users have already entered, so
      // they keep going straight to the app.
      // v3 → v4: notes (Note Taker) — nothing to migrate, just default in.
      // v4 → v5: AI reviews (device-local slice) — nothing to migrate.
      migrate: (persisted, version) => {
        const state = persisted as AppState & { overviewDateKey?: string; hasEnteredApp?: boolean };
        if (!state.notes) state.notes = {};
        if (!state.pendingDeletes) state.pendingDeletes = {};
        if (!state.aiReviews) state.aiReviews = {};
        if (state.aiEnabled === undefined) state.aiEnabled = false;
        if (version < 2 && state?.tasks) {
          const ids = Object.keys(state.tasks);
          ids.forEach((id, i) => {
            const t = state.tasks[id];
            if (!t.color) t.color = defaultColorForIndex(i);
            if (!t.icon) t.icon = defaultIconForIndex(i);
          });
        }
        if (!state.overviewDateKey) state.overviewDateKey = todayKey();
        if (state.hasEnteredApp === undefined) state.hasEnteredApp = version >= 1; // pre-landing users skip the gate
        return state;
      },
      // Persist the data domain only; UI flags stay ephemeral except the tab.
      partialize: (state) => ({
        profile: state.profile,
        dataOwnerUid: state.dataOwnerUid,
        tasks: state.tasks,
        logs: state.logs,
        notes: state.notes,
        aiReviews: state.aiReviews,
        aiEnabled: state.aiEnabled,
        pendingDeletes: state.pendingDeletes,
        activeTimer: state.activeTimer,
        seededAt: state.seededAt,
        hasEnteredApp: state.hasEnteredApp,
        activeTab: state.activeTab,
        overviewDateKey: state.overviewDateKey,
      }),
    }
  )
);

// ── selectors (reads are served from the local cache — §4.2) ────

export function selectTaskById(state: AppState, taskId: string | null | undefined): Task | undefined {
  return taskId ? state.tasks[taskId] : undefined;
}

// NOTE: selectors that return *derived collections* take the raw record
// (stable reference) and are meant to be used inside useMemo — calling
// them directly as Zustand selectors would allocate a new array every
// render and loop useSyncExternalStore (Zustand v5 requirement).

export function selectSortedActiveTasks(tasks: Record<string, Task>): Task[] {
  return Object.values(tasks)
    .filter((t) => !t.archived)
    .sort((a, b) => {
      const at = a.scheduledStart ?? '99:99';
      const bt = b.scheduledStart ?? '99:99';
      if (at !== bt) return at.localeCompare(bt);
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export function selectArchivedTasks(tasks: Record<string, Task>): Task[] {
  return Object.values(tasks)
    .filter((t) => t.archived)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Today's notes, newest first. Takes the raw notes record (use inside useMemo). */
export function selectTodayNotes(notes: Record<string, Note>): Note[] {
  const key = todayKey();
  return Object.values(notes)
    .filter((n) => n.dateKey === key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Notes linked to a specific task, newest first. Takes the raw notes record. */
export function selectNotesForTask(notes: Record<string, Note>, taskId: string): Note[] {
  return Object.values(notes)
    .filter((n) => n.taskId === taskId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Logs grouped by day bucket, newest first. Takes the raw logs record. */
export function selectLogsByDay(logs: Record<string, Log>): Array<[string, Log[]]> {
  const map = new Map<string, Log[]>();
  for (const log of Object.values(logs)) {
    const list = map.get(log.dateKey) ?? [];
    list.push(log);
    map.set(log.dateKey, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => [
      key,
      list.sort((a, b) => (b.startedAt ?? b.dateKey).localeCompare(a.startedAt ?? a.dateKey)),
    ]);
}
