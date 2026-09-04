/**
 * Firestore ↔ Zustand two-way mirror (the real §4.2 swap).
 *
 * Architecture:
 *   - The Zustand store remains the local-first source of truth for the UI.
 *   - A store subscription pushes every task/log/profile change to
 *     Firestore (fire-and-forget; the persistent cache queues writes
 *     made offline and replays them on reconnect).
 *   - onSnapshot listeners apply remote changes back into the store with
 *     last-write-wins resolution (updatedAt / syncedAt ISO clocks).
 *   - On first connect, local-only documents are uploaded in batches.
 *   - Deletions travel as TOMBSTONES: deleting a doc is invisible to
 *     queries, so a plain deleteDoc would silently resurrect on any
 *     stale session (first-of-session full repair push, uploadLocal,
 *     delta pull). Every deletion is mirrored into `users/{uid}/deletions`
 *     and kept locally (store.pendingDeletes) until the cloud confirms —
 *     every device then drops the doc and never re-adds it.
 *   - Deletions made OUTSIDE the app (Firebase console / REST / another
 *     client) leave no tombstone — without extra handling the local copy
 *     would look like a "never-synced local creation" and be re-uploaded
 *     by the next repair pass. Two defenses close that hole:
 *       a) live `removed` snapshot changes drop the local copy at once
 *          (handleExternalDeletions),
 *       b) the first server snapshot of a session drops any local doc the
 *          cloud once confirmed (its change clock predates the persisted
 *          last-clean-sync cutoff) instead of re-uploading it
 *          (reconcileLocalOnly).
 *   - `applyingRemote` guards against echo loops while writing remote
 *     data into the store.
 *   - Manual sync push/pull are delta-based (cloud-confirmed clocks +
 *     pull high-water marks) so "Sync now" stays fast as history grows
 *     into years of daily data — see the bookkeeping block below.
 *
 * Everything is defensive: a broken/misconfigured Firestore must never
 * take down the local-first app — failures degrade to console + one toast.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { isFirebaseConfigured, getFirebaseDb } from '@/lib/firebase/config';
import { pendingDeleteKey, useAppStore, type DeleteKind } from '@/store/use-app-store';
import { useAuthStore } from '@/store/use-auth-store';
import type { Log, Note, Profile, Task } from '@/types';

let applyingRemote = false;
let running = false;
let unsubs: Array<() => void> = [];
let syncedUid: string | null = null;
let warnedWriteFailure = false;
let syncInFlight = false;
let lastPullAt = 0;

// ── delta bookkeeping ────────────────────────────────────────────────
// "Sync now" must stay O(changes), not O(entire history): three years
// of daily use is ~10k logs/notes, and re-writing / re-downloading all
// of them on every sync would take minutes and trip the sync timeout.
//
// Push: `pushedClocks` remembers the change clock of every doc the
// cloud has CONFIRMED this session (batch commits and live-write acks).
// It starts empty, so the first sync of a session is a full repair pass
// — exactly what the "Sync now" button promises — and every sync after
// it only uploads docs whose clock moved. Failed batches leave their
// clocks unmarked, so a broken sync automatically re-pushes what it
// missed on the next attempt.
//
// Pull: `pullMarks` are per-collection high-water marks. The first pull
// of a session downloads the full library; later pulls only fetch docs
// whose change clock moved past the last mark, padded by a margin for
// devices with drifting clocks. Both reset on account switch.
type ClockMap = Record<string, string>;
const PUSH_BATCH = 450; // Firestore writeBatch caps at 500 ops — stay under
const PULL_SKEW_MARGIN_MS = 5 * 60 * 1000;
let pushedClocks: { tasks: ClockMap; logs: ClockMap; notes: ClockMap } = {
  tasks: {},
  logs: {},
  notes: {},
};
let pullMarks: { tasks?: string; logs?: string; notes?: string; deletions?: string } = {};

// Deletion bookkeeping (tombstones — see header comment):
// `deletionClocks` — tombstones this session has CONFIRMED with the cloud
// (their deletedAt), so sync doesn't re-push them.
// `remoteDeleted` — ids this session KNOWS are deleted (live deletions
// listener + pulls); remote appliers never resurrect these, and the
// first-of-session uploadLocal skips them.
let deletionClocks: ClockMap = {};
let remoteDeleted: Record<DeleteKind, Set<string>> = {
  tasks: new Set(),
  logs: new Set(),
  notes: new Set(),
};
const DELETION_DOC_ID = (kind: DeleteKind, id: string): string => `${kind}_${id}`;

/** Record a confirmed contact with the server (for the UI "last sync" line). */
function markSynced(): void {
  const iso = new Date().toISOString();
  useAuthStore.getState().setLastSyncAt(iso);
}

function warnWriteFailureOnce(scope: string, error: unknown) {
  console.warn(`[firestore-sync] ${scope} write failed:`, error);
  if (!warnedWriteFailure) {
    warnedWriteFailure = true;
    toast.error('Cloud sync write failed', {
      description: 'Check your Firestore security rules and connection. Local data is safe.',
      duration: 10000,
    });
  }
}

// ── doc mappers (explicit field mapping → no `undefined` ever reaches
//    Firestore, which rejects it) ─────────────────────────────────────────

function taskToDoc(t: Task): DocumentData {
  return {
    id: t.id,
    title: t.title,
    category: t.category ?? null,
    detail: t.detail ?? null,
    expectedDurationMinutes: t.expectedDurationMinutes,
    scheduledStart: t.scheduledStart ?? null,
    scheduledDateKey: t.scheduledDateKey ?? null,
    color: t.color,
    icon: t.icon,
    createdAt: t.createdAt,
    archived: t.archived,
    updatedAt: t.updatedAt ?? t.createdAt,
  };
}

function taskFromDoc(id: string, data: DocumentData): Task | null {
  if (!data || typeof data.title !== 'string') return null;
  return {
    id,
    title: data.title,
    category: data.category ?? null,
    detail: typeof data.detail === 'string' && data.detail.trim() ? data.detail.trim() : null,
    expectedDurationMinutes: Number(data.expectedDurationMinutes) || 15,
    scheduledStart: data.scheduledStart ?? null,
    scheduledDateKey: typeof data.scheduledDateKey === 'string' && data.scheduledDateKey ? data.scheduledDateKey : null,
    color: data.color ?? 'slate',
    icon: data.icon ?? 'circle',
    createdAt: data.createdAt ?? new Date().toISOString(),
    archived: Boolean(data.archived),
    updatedAt: data.updatedAt ?? data.createdAt ?? null,
  };
}

function logToDoc(l: Log): DocumentData {
  return {
    id: l.id,
    taskId: l.taskId,
    taskTitle: l.taskTitle,
    expectedMinutes: l.expectedMinutes,
    startedAt: l.startedAt ?? null,
    completedAt: l.completedAt ?? null,
    actualDurationSeconds: l.actualDurationSeconds ?? null,
    rating: l.rating ?? null,
    ratingSource: l.ratingSource ?? null,
    suggestedRating: l.suggestedRating ?? null,
    status: l.status,
    entryMode: l.entryMode,
    syncedAt: l.syncedAt ?? new Date().toISOString(),
    dateKey: l.dateKey,
  };
}

function logFromDoc(id: string, data: DocumentData): Log | null {
  if (!data || typeof data.taskId !== 'string') return null;
  return {
    id,
    taskId: data.taskId,
    taskTitle: data.taskTitle ?? '',
    expectedMinutes: Number(data.expectedMinutes) || 0,
    startedAt: data.startedAt ?? null,
    completedAt: data.completedAt ?? null,
    actualDurationSeconds: data.actualDurationSeconds ?? null,
    rating: data.rating ?? null,
    ratingSource: data.ratingSource ?? null,
    suggestedRating: data.suggestedRating ?? null,
    status: data.status ?? 'completed',
    entryMode: data.entryMode ?? 'tracked',
    syncedAt: data.syncedAt ?? null,
    dateKey: data.dateKey ?? '',
  };
}

function noteToDoc(n: Note): DocumentData {
  return {
    id: n.id,
    text: n.text,
    taskId: n.taskId ?? null,
    taskTitle: n.taskTitle ?? null,
    taskDateKey: n.taskDateKey ?? null,
    dateKey: n.dateKey,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt ?? n.createdAt,
  };
}

function noteFromDoc(id: string, data: DocumentData): Note | null {
  if (!data || typeof data.text !== 'string' || !data.text.trim()) return null;
  return {
    id,
    text: data.text,
    taskId: typeof data.taskId === 'string' && data.taskId ? data.taskId : null,
    taskTitle: typeof data.taskTitle === 'string' && data.taskTitle ? data.taskTitle : null,
    taskDateKey: typeof data.taskDateKey === 'string' && data.taskDateKey ? data.taskDateKey : null,
    dateKey: data.dateKey ?? '',
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: data.updatedAt ?? data.createdAt ?? null,
  };
}

function profileToDoc(p: Profile): DocumentData {
  return {
    uid: p.uid,
    displayName: p.displayName,
    email: p.email ?? null,
    createdAt: p.createdAt,
    settings: {
      defaultRatingThresholds: { badThreshold: p.settings.defaultRatingThresholds.badThreshold },
      notificationsEnabled: p.settings.notificationsEnabled,
    },
    updatedAt: p.updatedAt ?? p.createdAt,
  };
}

function newerRemote(remoteIso: string | null | undefined, localIso: string | null | undefined): boolean {
  return (remoteIso ?? '') > (localIso ?? '');
}

/** Change clocks — must match the LWW field each kind is merged with. */
function taskClock(t: Task): string {
  return t.updatedAt ?? t.createdAt;
}
function logClock(l: Log): string {
  return l.syncedAt ?? '';
}
function noteClock(n: Note): string {
  return n.updatedAt ?? n.createdAt;
}

// ── remote appliers (shared by onSnapshot listeners, the visibility
//    auto-heal and the manual Sync now) — return applied doc count ──────

function applyRemoteTasks(docs: Array<{ id: string; data: DocumentData }>): number {
  applyingRemote = true;
  const pending = useAppStore.getState().pendingDeletes;
  try {
    let applied = 0;
    useAppStore.setState((s) => {
      let tasks = s.tasks;
      let changed = false;
      for (const { id, data } of docs) {
        // Never resurrect a deleted doc (tombstone pending or confirmed).
        if (remoteDeleted.tasks.has(id) || pending[pendingDeleteKey('tasks', id)]) continue;
        const remote = taskFromDoc(id, data);
        const local = tasks[id];
        if (remote && (!local || newerRemote(remote.updatedAt, local.updatedAt))) {
          if (!changed) tasks = { ...tasks };
          tasks[id] = remote;
          changed = true;
          applied += 1;
        }
      }
      return changed ? { tasks } : {};
    });
    return applied;
  } finally {
    applyingRemote = false;
  }
}

function applyRemoteLogs(docs: Array<{ id: string; data: DocumentData }>): number {
  applyingRemote = true;
  const pending = useAppStore.getState().pendingDeletes;
  try {
    let applied = 0;
    useAppStore.setState((s) => {
      let logs = s.logs;
      let changed = false;
      for (const { id, data } of docs) {
        if (remoteDeleted.logs.has(id) || pending[pendingDeleteKey('logs', id)]) continue;
        const remote = logFromDoc(id, data);
        const local = logs[id];
        if (remote && (!local || newerRemote(remote.syncedAt, local.syncedAt))) {
          if (!changed) logs = { ...logs };
          logs[id] = remote;
          changed = true;
          applied += 1;
        }
      }
      return changed ? { logs } : {};
    });
    return applied;
  } finally {
    applyingRemote = false;
  }
}

function applyRemoteNotes(docs: Array<{ id: string; data: DocumentData }>): number {
  applyingRemote = true;
  const pending = useAppStore.getState().pendingDeletes;
  try {
    let applied = 0;
    useAppStore.setState((s) => {
      let notes = s.notes;
      let changed = false;
      for (const { id, data } of docs) {
        if (remoteDeleted.notes.has(id) || pending[pendingDeleteKey('notes', id)]) continue;
        const remote = noteFromDoc(id, data);
        const local = notes[id];
        if (remote && (!local || newerRemote(remote.updatedAt, local.updatedAt))) {
          if (!changed) notes = { ...notes };
          notes[id] = remote;
          changed = true;
          applied += 1;
        }
      }
      return changed ? { notes } : {};
    });
    return applied;
  } finally {
    applyingRemote = false;
  }
}

/**
 * Apply tombstones received from the cloud (`deletions` subcollection):
 * drop the local copies so another device's delete propagates here, and
 * remember the ids so doc listeners and later pulls never resurrect them.
 * A local edit NEWER than the deletion wins — it stays and will sync
 * back, re-creating the doc (last-writer-wins).
 */
function applyRemoteDeletions(
  kind: DeleteKind,
  entries: Array<{ id: string; deletedAt: string }>,
): number {
  applyingRemote = true;
  try {
    let removed = 0;
    useAppStore.setState((s) => {
      if (kind === 'tasks') {
        let tasks = s.tasks;
        let changed = false;
        for (const { id, deletedAt } of entries) {
          remoteDeleted.tasks.add(id);
          const local = tasks[id];
          if (!local) continue;
          if ((local.updatedAt ?? local.createdAt) > deletedAt) {
            remoteDeleted.tasks.delete(id); // newer local edit wins
            continue;
          }
          if (!changed) {
            tasks = { ...tasks };
            changed = true;
          }
          delete tasks[id];
          removed += 1;
        }
        return changed ? { tasks } : {};
      }
      if (kind === 'logs') {
        let logs = s.logs;
        let changed = false;
        for (const { id, deletedAt } of entries) {
          remoteDeleted.logs.add(id);
          const local = logs[id];
          if (!local) continue;
          if ((local.syncedAt ?? '') > deletedAt) {
            remoteDeleted.logs.delete(id);
            continue;
          }
          if (!changed) {
            logs = { ...logs };
            changed = true;
          }
          delete logs[id];
          removed += 1;
        }
        return changed ? { logs } : {};
      }
      let notes = s.notes;
      let changed = false;
      for (const { id, deletedAt } of entries) {
        remoteDeleted.notes.add(id);
        const local = notes[id];
        if (!local) continue;
        if ((local.updatedAt ?? local.createdAt) > deletedAt) {
          remoteDeleted.notes.delete(id);
          continue;
        }
        if (!changed) {
          notes = { ...notes };
          changed = true;
        }
        delete notes[id];
        removed += 1;
      }
      return changed ? { notes } : {};
    });
    return removed;
  } finally {
    applyingRemote = false;
  }
}

/** Split `deletions` docs by kind and apply them. */
function applyDeletionDocs(docs: Array<{ id: string; data: DocumentData }>): number {
  const byKind: Record<DeleteKind, Array<{ id: string; deletedAt: string }>> = {
    tasks: [],
    logs: [],
    notes: [],
  };
  for (const { data } of docs) {
    const kind = data.kind;
    if ((kind === 'tasks' || kind === 'logs' || kind === 'notes') && typeof data.id === 'string') {
      byKind[kind].push({
        id: data.id,
        deletedAt: typeof data.deletedAt === 'string' ? data.deletedAt : '',
      });
    }
  }
  let removed = 0;
  for (const kind of ['tasks', 'logs', 'notes'] as const) {
    if (byKind[kind].length > 0) removed += applyRemoteDeletions(kind, byKind[kind]);
  }
  return removed;
}

/** Remove docs from the local store WITHOUT echoing back through the
 *  store→Firestore subscription (applyingRemote skips it), then make the
 *  deletion durable: tombstone in the cloud `deletions` collection plus a
 *  best-effort deleteDoc (a no-op when the doc is already gone). Used for
 *  deletions detected from the server side — the user's delete action in
 *  the Firebase console or another tab — so they stay deleted everywhere. */
function dropLocalDocs(kind: DeleteKind, ids: string[], db: Firestore, uid: string): void {
  if (ids.length === 0) return;
  applyingRemote = true;
  try {
    useAppStore.setState((s) => {
      if (kind === 'tasks') {
        const tasks = { ...s.tasks };
        let changed = false;
        for (const id of ids) {
          if (tasks[id] !== undefined) {
            delete tasks[id];
            delete pushedClocks.tasks[id];
            changed = true;
          }
        }
        return changed ? { tasks } : {};
      }
      if (kind === 'logs') {
        const logs = { ...s.logs };
        let changed = false;
        for (const id of ids) {
          if (logs[id] !== undefined) {
            delete logs[id];
            delete pushedClocks.logs[id];
            changed = true;
          }
        }
        return changed ? { logs } : {};
      }
      const notes = { ...s.notes };
      let changed = false;
      for (const id of ids) {
        if (notes[id] !== undefined) {
          delete notes[id];
          delete pushedClocks.notes[id];
          changed = true;
        }
      }
      return changed ? { notes } : {};
    });
  } finally {
    applyingRemote = false;
  }
  for (const id of ids) {
    remoteDeleted[kind].add(id);
    // deletedAt = now — the removal was observed server-side, there is no
    // original tombstone clock to reuse.
    writeDeletion(db, uid, kind, id, {});
    deleteDoc(doc(db, 'users', uid, kind, id)).catch((e) =>
      warnWriteFailureOnce(`${kind} delete`, e),
    );
  }
}

/**
 * The server removed these docs while this session was live — either an
 * outside-the-app delete (Firebase console) or a delete already applied
 * in another tab. Drop the local copies unconditionally (an observed
 * server removal is authoritative — this is exactly what previously let
 * console-deleted records "sync back" from this device) and write
 * tombstones so every other device converges on the deletion.
 */
function handleExternalDeletions(kind: DeleteKind, ids: string[], db: Firestore, uid: string): void {
  const state = useAppStore.getState();
  const pending = state.pendingDeletes;
  const docs =
    kind === 'tasks' ? state.tasks : kind === 'logs' ? state.logs : state.notes;
  // Our own in-app deletes also surface as `removed` changes — they are
  // already handled via pendingDeletes, skip them here.
  const fresh = ids.filter((id) => docs[id] && !pending[pendingDeleteKey(kind, id)]);
  dropLocalDocs(kind, fresh, db, uid);
}

/** Persisted "last completed sync round-trip" clock (per uid). Any doc
 *  whose change clock predates this cutoff was already in the cloud at
 *  that moment — if the cloud no longer returns it, it was deleted
 *  outside the app (no tombstone exists) and must not be re-uploaded. */
const cleanSyncKey = (uid: string): string => `structure-planner:lastCleanSync:${uid}`;
function lastCleanSyncAt(uid: string): string {
  try {
    return localStorage.getItem(cleanSyncKey(uid)) ?? '';
  } catch {
    return '';
  }
}
function rememberCleanSync(uid: string): void {
  try {
    localStorage.setItem(cleanSyncKey(uid), new Date().toISOString());
  } catch {
    // storage unavailable (private mode) — external-delete detection
    // degrades to live `removed` events only
  }
}

/**
 * First server-originated snapshot of a session: every local doc missing
 * from the snapshot is either (a) a never-synced local creation — upload
 * it, or (b) a doc the cloud once confirmed but no longer returns — it
 * was deleted outside the app, leaving no tombstone → drop it locally +
 * write a tombstone so it stays deleted everywhere instead of
 * resurrecting on the next repair push. (b) is detected with the
 * persisted last-clean-sync cutoff; without a cutoff yet (no completed
 * manual sync ever) everything local-only is uploaded, as before.
 */
function reconcileLocalOnly(
  kind: DeleteKind,
  remoteIds: Set<string>,
  db: Firestore,
  uid: string,
): void {
  const st = useAppStore.getState();
  const pending = st.pendingDeletes;
  const known = remoteDeleted[kind];
  const localOnly =
    kind === 'tasks'
      ? Object.values(st.tasks).filter(
          (t) => !remoteIds.has(t.id) && !known.has(t.id) && !pending[pendingDeleteKey('tasks', t.id)],
        )
      : kind === 'logs'
        ? Object.values(st.logs).filter(
            (l) => !remoteIds.has(l.id) && !known.has(l.id) && !pending[pendingDeleteKey('logs', l.id)],
          )
        : Object.values(st.notes).filter(
            (n) => !remoteIds.has(n.id) && !known.has(n.id) && !pending[pendingDeleteKey('notes', n.id)],
          );
  if (localOnly.length === 0) return;

  const cutoff = lastCleanSyncAt(uid);
  const dropIds = new Set<string>();
  const upload: Array<Task | Log | Note> = [];
  for (const item of localOnly) {
    const clock =
      kind === 'tasks'
        ? taskClock(item as Task)
        : kind === 'logs'
          ? logClock(item as Log)
          : noteClock(item as Note);
    // Empty clock = never touched by the sync engine → always upload.
    if (cutoff && clock && clock <= cutoff) {
      dropIds.add(item.id);
    } else {
      upload.push(item);
    }
  }
  if (dropIds.size > 0) {
    console.info(
      `[firestore-sync] dropping ${dropIds.size} ${kind} deleted outside the app (present locally, absent from cloud, clock ≤ last clean sync)`,
    );
    dropLocalDocs(kind, [...dropIds], db, uid);
  }
  if (upload.length > 0) uploadLocal(kind, upload, db, uid);
}

/** Mirror a local deletion into the cloud `deletions` collection so other
 *  devices drop the doc too. Uses the store's tombstone clock when the
 *  delete went through a store action (tasks/notes), else now (logs). */
function writeDeletion(
  db: Firestore,
  uid: string,
  kind: DeleteKind,
  id: string,
  pending: Record<string, { kind: DeleteKind; id: string; deletedAt: string }>,
): void {
  const key = pendingDeleteKey(kind, id);
  const deletedAt = pending[key]?.deletedAt ?? new Date().toISOString();
  setDoc(
    doc(db, 'users', uid, 'deletions', DELETION_DOC_ID(kind, id)),
    { kind, id, deletedAt },
    { merge: true },
  )
    .then(() => {
      deletionClocks[key] = deletedAt;
    })
    .catch((e) => warnWriteFailureOnce(`${kind} tombstone`, e));
}

function applyRemoteProfile(data: DocumentData): number {
  applyingRemote = true;
  try {
    let applied = 0;
    useAppStore.setState((s) => {
      if (!newerRemote(data.updatedAt, s.profile.updatedAt)) return {};
      applied = 1;
      const remoteName = typeof data.displayName === 'string' ? data.displayName : null;
      return {
        profile: {
          ...s.profile,
          displayName: remoteName || s.profile.displayName,
          email: data.email ?? s.profile.email,
          createdAt: data.createdAt ?? s.profile.createdAt,
          updatedAt: data.updatedAt ?? s.profile.updatedAt,
          settings: {
            defaultRatingThresholds: {
              badThreshold:
                Number(data.settings?.defaultRatingThresholds?.badThreshold) ||
                s.profile.settings.defaultRatingThresholds.badThreshold,
            },
            notificationsEnabled:
              data.settings?.notificationsEnabled ?? s.profile.settings.notificationsEnabled,
          },
        },
      };
    });
    return applied;
  } finally {
    applyingRemote = false;
  }
}

/** Query floor for a delta pull: the last high-water mark, padded back by
 *  the skew margin so client clocks that run fast don't create blind spots. */
function pullFloor(kind: 'tasks' | 'logs' | 'notes' | 'deletions'): string {
  const base = Date.parse(pullMarks[kind] ?? '');
  if (Number.isNaN(base)) return '';
  return new Date(base - PULL_SKEW_MARGIN_MS).toISOString();
}

/** Fold the received docs' clocks into the collection's high-water mark. */
function bumpPullMark(
  kind: 'tasks' | 'logs' | 'notes' | 'deletions',
  docs: Array<{ id: string; data: DocumentData }>,
): void {
  const field = kind === 'logs' ? 'syncedAt' : kind === 'deletions' ? 'deletedAt' : 'updatedAt';
  let max = pullMarks[kind] ?? '';
  for (const { data } of docs) {
    const clock = data[field];
    if (typeof clock === 'string' && clock > max) max = clock;
  }
  pullMarks[kind] = max;
}

/**
 * Server-originated read (heals a stale/dead snapshot listener).
 * The first pull of a session downloads the full library; every later
 * pull is a delta query per collection (change clock > last mark), so a
 * manual sync stays fast even with years of accumulated history. Empty
 * marks (fresh sign-in, empty cache) naturally degrade to a full pull.
 */
export async function pullOnce(uid: string): Promise<{ pulled: number; clean: boolean }> {
  if (!isFirebaseConfigured || !running || syncedUid !== uid) return { pulled: 0, clean: false };
  lastPullAt = Date.now();
  const db: Firestore = getFirebaseDb();

  const tasksCol = collection(db, 'users', uid, 'tasks');
  const logsCol = collection(db, 'users', uid, 'logs');
  const notesCol = collection(db, 'users', uid, 'notes');
  const deletionsCol = collection(db, 'users', uid, 'deletions');

  const [tasksRes, logsRes, notesRes, deletionsRes, profileRes] = await Promise.allSettled([
    getDocsFromServer(
      query(tasksCol, where('updatedAt', '>', pullFloor('tasks')), orderBy('updatedAt')),
    ),
    getDocsFromServer(
      query(logsCol, where('syncedAt', '>', pullFloor('logs')), orderBy('syncedAt')),
    ),
    getDocsFromServer(
      query(notesCol, where('updatedAt', '>', pullFloor('notes')), orderBy('updatedAt')),
    ),
    getDocsFromServer(
      query(deletionsCol, where('deletedAt', '>', pullFloor('deletions')), orderBy('deletedAt')),
    ),
    getDocFromServer(doc(db, 'users', uid)),
  ]);

  let pulled = 0;
  if (tasksRes.status === 'fulfilled') {
    const docs = tasksRes.value.docs.map((d) => ({ id: d.id, data: d.data() }));
    pulled += applyRemoteTasks(docs);
    bumpPullMark('tasks', docs);
  } else {
    console.warn('[firestore-sync] pull tasks:', tasksRes.reason);
  }
  if (logsRes.status === 'fulfilled') {
    const docs = logsRes.value.docs.map((d) => ({ id: d.id, data: d.data() }));
    pulled += applyRemoteLogs(docs);
    bumpPullMark('logs', docs);
  } else {
    console.warn('[firestore-sync] pull logs:', logsRes.reason);
  }
  if (notesRes.status === 'fulfilled') {
    const docs = notesRes.value.docs.map((d) => ({ id: d.id, data: d.data() }));
    pulled += applyRemoteNotes(docs);
    bumpPullMark('notes', docs);
  } else {
    console.warn('[firestore-sync] pull notes:', notesRes.reason);
  }
  if (deletionsRes.status === 'fulfilled') {
    const docs = deletionsRes.value.docs.map((d) => ({ id: d.id, data: d.data() }));
    pulled += applyDeletionDocs(docs);
    bumpPullMark('deletions', docs);
  } else {
    console.warn('[firestore-sync] pull deletions:', deletionsRes.reason);
  }
  if (profileRes.status === 'fulfilled' && profileRes.value.exists()) {
    pulled += applyRemoteProfile(profileRes.value.data());
  } else if (profileRes.status === 'rejected') {
    console.warn('[firestore-sync] pull profile:', profileRes.reason);
  }

  // A completed round-trip counts as "last sync" even when nothing
  // changed — that timestamp is what the user reads as "contacted cloud".
  const allFulfilled =
    tasksRes.status === 'fulfilled' &&
    logsRes.status === 'fulfilled' &&
    notesRes.status === 'fulfilled' &&
    deletionsRes.status === 'fulfilled' &&
    profileRes.status === 'fulfilled';
  if (allFulfilled) {
    markSynced();
  }
  return { pulled, clean: allFulfilled };
}

interface PushEntry {
  id: string;
  data: DocumentData;
  clock: string;
}

/** Docs whose local change clock differs from what the cloud confirmed. */
function collectDirty(kind: 'tasks' | 'logs' | 'notes'): PushEntry[] {
  const s = useAppStore.getState();
  const confirmed = pushedClocks[kind];
  const out: PushEntry[] = [];
  const consider = (id: string, data: DocumentData, clock: string) => {
    if (confirmed[id] !== clock) out.push({ id, data, clock });
  };
  if (kind === 'tasks') {
    for (const t of Object.values(s.tasks)) consider(t.id, taskToDoc(t), taskClock(t));
  } else if (kind === 'logs') {
    for (const l of Object.values(s.logs)) consider(l.id, logToDoc(l), logClock(l));
  } else {
    for (const n of Object.values(s.notes)) consider(n.id, noteToDoc(n), noteClock(n));
  }
  return out;
}

/**
 * Push local docs to Firestore in 450-op batches. Only docs the cloud
 * hasn't confirmed yet are sent (the first sync of a session sends
 * everything — a deliberate full repair pass); each batch marks its
 * docs' clocks on success only, so failed batches re-push next time.
 */
async function pushAll(uid: string): Promise<{ pushed: number; clean: boolean }> {
  const db: Firestore = getFirebaseDb();
  const plan = {
    tasks: collectDirty('tasks'),
    logs: collectDirty('logs'),
    notes: collectDirty('notes'),
  };
  // Tombstones awaiting cloud confirmation (offline deletes land here).
  const tombstones = Object.entries(useAppStore.getState().pendingDeletes).filter(
    ([key, t]) => deletionClocks[key] !== t.deletedAt,
  );
  const total = plan.tasks.length + plan.logs.length + plan.notes.length + tombstones.length;
  if (total === 0) return { pushed: 0, clean: true };

  const s = useAppStore.getState();
  let pushed = 0;
  const confirmedTombstones: string[] = [];
  const jobs: Array<Promise<void>> = [
    // Clock-checked profile push. pushAll runs BEFORE the pull in syncNow,
    // so an unconditional write would let a stale local profile clobber a
    // newer edit made on another device. If the cloud copy is newer, skip
    // the write — pullOnce adopts it into the store right after.
    getDocFromServer(doc(db, 'users', uid))
      .then((snap) => {
        const remoteUpdatedAt = snap.exists() ? snap.data().updatedAt : undefined;
        if (newerRemote(typeof remoteUpdatedAt === 'string' ? remoteUpdatedAt : null, s.profile.updatedAt)) {
          return undefined;
        }
        return setDoc(doc(db, 'users', uid), profileToDoc(s.profile), { merge: true });
      })
      .then(() => undefined),
  ];
  for (const kind of ['tasks', 'logs', 'notes'] as const) {
    for (let i = 0; i < plan[kind].length; i += PUSH_BATCH) {
      const slice = plan[kind].slice(i, i + PUSH_BATCH);
      const batch = writeBatch(db);
      for (const entry of slice) {
        batch.set(doc(db, 'users', uid, kind, entry.id), entry.data, { merge: true });
      }
      jobs.push(
        batch.commit().then(() => {
          for (const entry of slice) pushedClocks[kind][entry.id] = entry.clock;
          pushed += slice.length;
        }),
      );
    }
  }
  // Tombstone batches: delete the cloud doc AND record the deletion so
  // every other device drops its local copy too. (batch.delete on a doc
  // that doesn't exist is a no-op, so this is safe to retry.)
  for (let i = 0; i < tombstones.length; i += PUSH_BATCH) {
    const slice = tombstones.slice(i, i + PUSH_BATCH);
    const batch = writeBatch(db);
    for (const [key, t] of slice) {
      batch.delete(doc(db, 'users', uid, t.kind, t.id));
      batch.set(doc(db, 'users', uid, 'deletions', DELETION_DOC_ID(t.kind, t.id)), {
        kind: t.kind,
        id: t.id,
        deletedAt: t.deletedAt,
      });
    }
    jobs.push(
      batch.commit().then(() => {
        for (const [key, t] of slice) {
          deletionClocks[key] = t.deletedAt;
          confirmedTombstones.push(key);
        }
        pushed += slice.length;
      }),
    );
  }

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(
      `[firestore-sync] pushAll: ${failed}/${results.length} write group(s) failed:`,
      results.find((r) => r.status === 'rejected'),
    );
  } else if (confirmedTombstones.length > 0) {
    // Every batch committed — the cloud durably knows about these deletes;
    // drop the local tombstones. On partial failure they are kept and
    // re-pushed on the next sync (all writes are idempotent).
    useAppStore.getState().clearPendingDeletes(confirmedTombstones);
  }
  return { pushed, clean: failed === 0 };
}

export type SyncNowResult = {
  ok: boolean;
  online: boolean;
  /** Local docs uploaded to Firestore. */
  pushed: number;
  /** Remote docs applied into the store. */
  pulled: number;
  reason?: 'offline' | 'timeout' | 'error';
};

/**
 * Manual "Sync now": restarts the mirror (fresh onSnapshot listeners — the
 * usual fix when a phone suspended the tab and sync stopped being live),
 * force-uploads every local doc, then pulls a fresh server snapshot.
 */
export async function syncNow(uid: string): Promise<SyncNowResult> {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!isFirebaseConfigured) return { ok: false, online, pushed: 0, pulled: 0, reason: 'error' };
  if (syncInFlight) return { ok: true, online, pushed: 0, pulled: 0 };
  if (!online) return { ok: false, online: false, pushed: 0, pulled: 0, reason: 'offline' };

  syncInFlight = true;
  useAuthStore.getState().setSyncBusy(true);
  try {
    const work = (async () => {
      // 1) Teardown possibly-dead listeners, 2) push pending local docs
      // (full repair pass on the first sync of a session), 3) re-attach
      // listeners + store mirror (same session — keep delta state),
      // 4) explicit server pull (delta after the first one).
      stopFirestoreSync();
      const { pushed, clean: pushClean } = await pushAll(uid);
      startFirestoreSync(uid, { freshSession: false });
      const { pulled, clean: pullClean } = await pullOnce(uid);
      // A fully clean round-trip means every local doc the cloud wants is
      // now there — remember the clock so the next session can tell
      // externally-deleted docs apart from never-synced local creations
      // (see reconcileLocalOnly).
      if (pushClean && pullClean) rememberCleanSync(uid);
      markSynced();
      return { pushed, pulled };
    });

    // 30s — generous enough for a first-of-session full repair pass
    // (push + pull of the whole library); delta syncs land in seconds.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('sync-timeout')), 30000),
    );
    const { pushed, pulled } = await Promise.race([work(), timeout]);
    return { ok: true, online: true, pushed, pulled };
  } catch (error) {
    console.warn('[firestore-sync] syncNow failed:', error);
    // Listeners may be down (stopped but never re-attached) — best effort
    // recovery so automatic sync keeps trying after a failed manual run.
    try {
      if (!running) startFirestoreSync(uid);
    } catch {
      // genuinely broken Firebase config — the local-first app keeps working
    }
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false,
      online: true,
      pushed: 0,
      pulled: 0,
      reason: message.includes('sync-timeout') ? 'timeout' : 'error',
    };
  } finally {
    syncInFlight = false;
    useAuthStore.getState().setSyncBusy(false);
  }
}

// ── start / stop ────────────────────────────────────────────────────────

export function startFirestoreSync(uid: string, opts?: { freshSession?: boolean }): void {
  if (!isFirebaseConfigured || running) return;

  stopFirestoreSync();
  running = true;
  const fresh = opts?.freshSession ?? syncedUid !== uid;
  syncedUid = uid;
  if (fresh) {
    // New account session — forget any clock/mark state from the
    // previous account so the next sync runs full repair passes.
    pushedClocks = { tasks: {}, logs: {}, notes: {} };
    pullMarks = {};
    deletionClocks = {};
    remoteDeleted = { tasks: new Set(), logs: new Set(), notes: new Set() };
  }
  const db: Firestore = getFirebaseDb();

  const tasksCol = collection(db, 'users', uid, 'tasks');
  const logsCol = collection(db, 'users', uid, 'logs');
  const notesCol = collection(db, 'users', uid, 'notes');
  const deletionsCol = collection(db, 'users', uid, 'deletions');
  const profileRef = doc(db, 'users', uid);

  // ── store → Firestore ────────────────────────────────────────────────
  const unsubStore = useAppStore.subscribe((state, prev) => {
    if (applyingRemote) return;

    for (const [id, t] of Object.entries(state.tasks)) {
      if (prev.tasks[id] !== t) {
        const clock = taskClock(t);
        setDoc(doc(tasksCol, id), taskToDoc(t), { merge: true })
          .then(() => {
            pushedClocks.tasks[id] = clock;
          })
          .catch((e) => warnWriteFailureOnce('task', e));
      }
    }
    for (const id of Object.keys(prev.tasks)) {
      if (!state.tasks[id]) {
        delete pushedClocks.tasks[id];
        writeDeletion(db, uid, 'tasks', id, state.pendingDeletes);
        deleteDoc(doc(tasksCol, id)).catch((e) => warnWriteFailureOnce('task delete', e));
      }
    }

    for (const [id, l] of Object.entries(state.logs)) {
      if (prev.logs[id] !== l) {
        const clock = logClock(l);
        setDoc(doc(logsCol, id), logToDoc(l), { merge: true })
          .then(() => {
            pushedClocks.logs[id] = clock;
          })
          .catch((e) => warnWriteFailureOnce('log', e));
      }
    }
    for (const id of Object.keys(prev.logs)) {
      if (!state.logs[id]) {
        delete pushedClocks.logs[id];
        writeDeletion(db, uid, 'logs', id, state.pendingDeletes);
        deleteDoc(doc(logsCol, id)).catch((e) => warnWriteFailureOnce('log delete', e));
      }
    }

    for (const [id, n] of Object.entries(state.notes)) {
      if (prev.notes[id] !== n) {
        const clock = noteClock(n);
        setDoc(doc(notesCol, id), noteToDoc(n), { merge: true })
          .then(() => {
            pushedClocks.notes[id] = clock;
          })
          .catch((e) => warnWriteFailureOnce('note', e));
      }
    }
    for (const id of Object.keys(prev.notes)) {
      if (!state.notes[id]) {
        delete pushedClocks.notes[id];
        writeDeletion(db, uid, 'notes', id, state.pendingDeletes);
        deleteDoc(doc(notesCol, id)).catch((e) => warnWriteFailureOnce('note delete', e));
      }
    }

    if (state.profile !== prev.profile) {
      setDoc(profileRef, profileToDoc(state.profile), { merge: true }).catch((e) =>
        warnWriteFailureOnce('profile', e),
      );
    }
  });
  unsubs.push(unsubStore);

  // ── Firestore → store ────────────────────────────────────────────────

  // Tasks
  let reconciledTasks = false;
  unsubs.push(
    onSnapshot(
      tasksCol,
      (snap) => {
        // Docs the server removed while this session was live (deleted
        // outside the app or in another tab) must not linger locally —
        // a stale copy would be re-uploaded by the next repair push.
        const removed = snap.docChanges().filter((c) => c.type === 'removed').map((c) => c.doc.id);
        if (removed.length > 0) handleExternalDeletions('tasks', removed, db, uid);

        const applied = applyRemoteTasks(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
        if (applied > 0) markSynced();

        // The upload decision needs a SERVER snapshot: a cached one still
        // contains docs the server has since deleted, so trusting it would
        // resurrect exactly the records we must drop.
        if (!reconciledTasks && !snap.metadata.fromCache) {
          reconciledTasks = true;
          reconcileLocalOnly('tasks', new Set(snap.docs.map((d) => d.id)), db, uid);
        }
      },
      (error) => console.warn('[firestore-sync] tasks listener:', error),
    ),
  );

  // Logs
  let reconciledLogs = false;
  unsubs.push(
    onSnapshot(
      logsCol,
      (snap) => {
        const removed = snap.docChanges().filter((c) => c.type === 'removed').map((c) => c.doc.id);
        if (removed.length > 0) handleExternalDeletions('logs', removed, db, uid);

        const applied = applyRemoteLogs(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
        if (applied > 0) markSynced();

        if (!reconciledLogs && !snap.metadata.fromCache) {
          reconciledLogs = true;
          reconcileLocalOnly('logs', new Set(snap.docs.map((d) => d.id)), db, uid);
        }
      },
      (error) => console.warn('[firestore-sync] logs listener:', error),
    ),
  );

  // Notes
  let reconciledNotes = false;
  unsubs.push(
    onSnapshot(
      notesCol,
      (snap) => {
        const removed = snap.docChanges().filter((c) => c.type === 'removed').map((c) => c.doc.id);
        if (removed.length > 0) handleExternalDeletions('notes', removed, db, uid);

        const applied = applyRemoteNotes(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
        if (applied > 0) markSynced();

        if (!reconciledNotes && !snap.metadata.fromCache) {
          reconciledNotes = true;
          reconcileLocalOnly('notes', new Set(snap.docs.map((d) => d.id)), db, uid);
        }
      },
      (error) => console.warn('[firestore-sync] notes listener:', error),
    ),
  );

  // Profile
  unsubs.push(
    onSnapshot(
      profileRef,
      (snap) => {
        if (!snap.exists()) return;
        const applied = applyRemoteProfile(snap.data());
        if (applied > 0) markSynced();
      },
      (error) => console.warn('[firestore-sync] profile listener:', error),
    ),
  );

  // Deletions — tombstones from any device. The first snapshot carries the
  // full deletion history, which heals a device that was offline when the
  // delete happened (queries can't express "this doc is gone").
  unsubs.push(
    onSnapshot(
      deletionsCol,
      (snap) => {
        if (snap.empty) return;
        const removed = applyDeletionDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
        if (removed > 0) markSynced();
      },
      (error) => console.warn('[firestore-sync] deletions listener:', error),
    ),
  );

  // ── auto-heal: mobile browsers suspend WebSocket listeners while the
  //    tab is backgrounded (iOS Safari especially) and they don't always
  //    wake up cleanly. On return to the foreground or network reconnect,
  //    pull a fresh server snapshot so changes made elsewhere show up
  //    without anyone pressing refresh. ──
  if (typeof window !== 'undefined') {
    const heal = () => {
      if (document.visibilityState !== 'visible') return;
      if (!navigator.onLine) return;
      if (Date.now() - lastPullAt < 10_000) return; // debounce tab-switch storms
      void pullOnce(uid).catch(() => {});
    };
    window.addEventListener('online', heal);
    document.addEventListener('visibilitychange', heal);
    unsubs.push(() => {
      window.removeEventListener('online', heal);
      document.removeEventListener('visibilitychange', heal);
    });
  }
}

/** Batched upload of local-only documents (450 per batch), called from
 *  reconcileLocalOnly for docs the cloud never had. Successful batches
 *  mark their docs as cloud-confirmed so the next manual sync doesn't
 *  re-push them. */
function uploadLocal(
  kind: 'tasks' | 'logs' | 'notes',
  docs: Array<Task | Log | Note>,
  db: Firestore,
  uid: string,
): void {
  const clockOf = (item: Task | Log | Note): string =>
    kind === 'tasks'
      ? taskClock(item as Task)
      : kind === 'logs'
        ? logClock(item as Log)
        : noteClock(item as Note);

  const commitBatch = (batch: WriteBatch, slice: Array<Task | Log | Note>) => {
    batch
      .commit()
      .then(() => {
        const confirmed = pushedClocks[kind];
        for (const item of slice) confirmed[item.id] = clockOf(item);
      })
      .catch((e) => warnWriteFailureOnce(`upload ${kind}`, e));
  };

  let batch = writeBatch(db);
  let slice: Array<Task | Log | Note> = [];
  for (const item of docs) {
    const data =
      kind === 'tasks'
        ? taskToDoc(item as Task)
        : kind === 'logs'
          ? logToDoc(item as Log)
          : noteToDoc(item as Note);
    batch.set(doc(db, 'users', uid, kind, item.id), data, { merge: true });
    slice.push(item);
    if (slice.length === PUSH_BATCH) {
      commitBatch(batch, slice);
      batch = writeBatch(db);
      slice = [];
    }
  }
  if (slice.length > 0) commitBatch(batch, slice);
  console.info(`[firestore-sync] uploaded ${docs.length} local ${kind}`);
}

export function stopFirestoreSync(): void {
  for (const unsub of unsubs) {
    try {
      unsub();
    } catch {
      // listener already torn down
    }
  }
  unsubs = [];
  running = false;
  syncedUid = null;
}

/** True while a mirror session for this uid is live. */
export function isSyncing(uid?: string): boolean {
  return running && (uid === undefined || syncedUid === uid);
}
