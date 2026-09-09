'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Link2, NotebookPen, Sparkles, X } from 'lucide-react';
import { addDays, isToday } from 'date-fns';
import {
  FullScreenModal,
  ModalContent,
  ModalDescription,
  ModalTitle,
} from '@/components/ui/full-screen-modal';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { selectSortedActiveTasks, useAppStore } from '@/store/use-app-store';
import { toast } from 'sonner';
import { dateKeyOf, friendlyDayLabel, parseDayKey, timeOfDay, todayKey } from '@/lib/format';
import { iconMeta, taskColorMeta } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import { AiReviewSheet, type ReviewDraftTarget } from '@/components/ai-review-sheet';
import {
  applyFixToText,
  formatAnswerBlocks,
  type ReviewAnswerBlock,
  type ReviewFixEdit,
} from '@/lib/ai/provider';
import type { LogStatus, Task } from '@/types';

/** How far back the day picker can go when linking a note to a past task. */
const MAX_LOOKBACK_DAYS = 30;

interface DayAttempt {
  status: LogStatus;
  completedAt: string | null;
  startedAt: string | null;
}

/**
 * Note Taker — quick capture in two taps.
 *
 * Two simple modes:
 *   1. Quick note   — type and save, nothing else.
 *   2. Linked note  — toggle "Link to a task", pick a day (defaults to
 *                     today, arrows move one day at a time), tap any of
 *                     that day's tasks, save. Completed tasks show their
 *                     finish time; pending ones show their slot.
 *
 * When AI review is enabled, a "Review with AI" button sits directly
 * above Save (plan §4.1): the review runs on the UNSAVED draft, and any
 * answers flow back into the draft, so every change is visible before
 * the note is saved. Opened from the header/FAB button, or pre-linked
 * from a task's action sheet (noteTakerTaskId preset → the sheet starts
 * attached to that task).
 *
 * Save is the END of the flow (v2.1): the note is written, the sheet
 * closes itself, and the toast — not a blocking screen — is the entire
 * confirmation. The old post-save "Find it on Today, under Notes."
 * interstitial charged a third tap for information the toast already
 * delivered, on a sheet whose promise was capture in two taps.
 */
export function NoteTakerSheet() {
  const open = useAppStore((s) => s.noteTakerOpen);
  const presetTaskId = useAppStore((s) => s.noteTakerTaskId);
  const closeNoteTaker = useAppStore((s) => s.closeNoteTaker);

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && closeNoteTaker()}>
      <ModalContent data-testid="note-taker-sheet">
        {open && (
          <NoteTakerFields
            key={presetTaskId ?? 'quick'}
            presetTaskId={presetTaskId}
            onCancel={closeNoteTaker}
          />
        )}
      </ModalContent>
    </FullScreenModal>
  );
}

function NoteTakerFields({
  presetTaskId,
  onCancel,
}: {
  presetTaskId: string | null;
  onCancel: () => void;
}) {
  const tasksRecord = useAppStore((s) => s.tasks);
  const logs = useAppStore((s) => s.logs);
  const addNote = useAppStore((s) => s.addNote);
  const aiEnabled = useAppStore((s) => s.aiEnabled);

  const [text, setText] = useState('');
  /** Pre-save draft review — the review's target while the note is unsaved. */
  const [draftReview, setDraftReview] = useState<ReviewDraftTarget | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(presetTaskId ?? null);
  /** Day the linked task belongs to — captured at selection time. */
  const [linkedDateKey, setLinkedDateKey] = useState<string | null>(
    presetTaskId != null ? todayKey() : null,
  );
  const [linkTouched, setLinkTouched] = useState(presetTaskId != null);
  /** Day being browsed in the picker (defaults to today). */
  const [browseDateKey, setBrowseDateKey] = useState(todayKey());

  const tasks = useMemo(() => selectSortedActiveTasks(tasksRecord), [tasksRecord]);

  const browseIsToday = isToday(parseDayKey(browseDateKey));
  const minDateKey = dateKeyOf(addDays(new Date(), -MAX_LOOKBACK_DAYS));

  const shiftBrowse = (days: number) => {
    setBrowseDateKey(dateKeyOf(addDays(parseDayKey(browseDateKey), days)));
  };

  /** Latest attempt per task on the browsed day (logs are day-bucketed). */
  const dayAttempts = useMemo(() => {
    const map = new Map<string, DayAttempt>();
    for (const log of Object.values(logs)) {
      if (log.dateKey !== browseDateKey) continue;
      const stamp = log.completedAt ?? log.startedAt ?? '';
      const prev = map.get(log.taskId);
      if (!prev || stamp > (prev.completedAt ?? prev.startedAt ?? '')) {
        map.set(log.taskId, {
          status: log.status,
          completedAt: log.completedAt,
          startedAt: log.startedAt,
        });
      }
    }
    return map;
  }, [logs, browseDateKey]);

  const linkedTask = linkedTaskId ? tasksRecord[linkedTaskId] : undefined;
  const canSave = text.trim().length > 0;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  /**
   * Save and DONE (v2.1) — the write is the last thing this sheet shows.
   * The toast carries the outcome (linked task, when there is one); a
   * quick note needs no description because the new note is visible on
   * Today the moment the sheet closes. No interstitial, no Done tap.
   */
  const save = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const note = addNote({
      text: trimmed,
      taskId: linkedTaskId ?? null,
      taskDateKey: linkedTaskId ? (linkedDateKey ?? todayKey()) : null,
    });
    toast.success('Note saved', {
      description: note.taskTitle
        ? `Linked to "${note.taskTitle}"${linkedDateKey && linkedDateKey !== todayKey() ? ` · ${friendlyDayLabel(linkedDateKey)}` : ''}`
        : undefined,
    });
    onCancel();
  };

  // Pre-save review (plan §4.1): the button sits above Save so the check
  // happens BEFORE saving — fixes land in the draft, then the user saves.
  // `seq` is the sheet's per-open mount key: it stays constant while fixes
  // edit the text, and changes only when a NEW review is opened.
  const openDraftReview = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraftReview({
      text: trimmed,
      taskId: linkedTaskId,
      dateKey: linkedTaskId ? (linkedDateKey ?? todayKey()) : todayKey(),
      seq: Date.now(),
    });
    setReviewOpen(true);
  };

  /** Draft-mode answers join the composer text — visible before Save. */
  const addAnswersToDraft = (blocks: ReviewAnswerBlock[]) => {
    const addition = formatAnswerBlocks(blocks);
    setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${addition}` : addition));
  };

  /** Draft-mode fixes: each edit replaces its exact quoted spot (chained in
   *  card order, skipped when a spot is gone) — in the composer text AND the
   *  review's live snapshot, so the sheet's strip shows the new wording.
   *  The stable `seq` key keeps the review mounted while the text changes. */
  const applyFixesToDraft = (edits: ReviewFixEdit[]) => {
    const applyAll = (t: string) => {
      let next = t;
      for (const edit of edits) {
        const r = applyFixToText(next, edit.find, edit.replaceWith);
        if (r !== null) next = r;
      }
      return next;
    };
    setText(applyAll);
    setDraftReview((d) => (d ? { ...d, text: applyAll(d.text) } : d));
  };

  /** The review's Save draft: the composer saves what it has — applied
   *  fixes and prior additions included — and everything closes at once:
   *  review, composer, done. The note is already on Today when the
   *  sheets are gone; nothing is re-reviewed or re-decided here. */
  const saveDraftFromReview = () => {
    setReviewOpen(false);
    save();
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <ModalTitle className="sr-only">Quick note</ModalTitle>
      <ModalDescription className="sr-only">
        Write a quick note, optionally linked to any task from any day
      </ModalDescription>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-primary/10">
            <NotebookPen className="size-4 text-primary" aria-hidden />
          </span>
          <h2 className="text-[15px] font-semibold">Quick note</h2>
        </div>
        <button
          onClick={onCancel}
          aria-label="Close"
          className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid="note-close"
        >
          <X className="size-4" />
        </button>
        </div>
      </div>

      <div className="mx-auto min-h-0 w-full max-w-md flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-1">
        {/* The note itself — auto-focused, the very first thing you touch */}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
          }}
          placeholder="What did you notice?"
          rows={6}
          autoFocus
          aria-label="Note text"
          className="max-h-[260px] min-h-[140px] resize-none overflow-y-auto"
          data-testid="note-text-input"
        />

        {/* Linked → a removable chip. Unlinked → the optional toggle + picker. */}
        {linkedTask ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-medium">{linkedTask.title}</span>
              {linkedDateKey && linkedDateKey !== todayKey() && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  · {friendlyDayLabel(linkedDateKey)}
                </span>
              )}
            </span>
            <button
              onClick={() => {
                setLinkedTaskId(null);
                setLinkedDateKey(null);
                setLinkTouched(false);
              }}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Unlink task"
              data-testid="note-link-remove"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <>
            {/* Optional link — off by default so the quick path stays 2 taps */}
            <div className="flex items-center justify-between rounded-xl border px-3.5 py-3">
              <div>
                <Label htmlFor="note-link" className="text-sm">
                  Link to a task
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Optional — any task, today or another day
                </p>
              </div>
              <Switch
                id="note-link"
                checked={linkTouched}
                onCheckedChange={(on) => {
                  setLinkTouched(on);
                  if (!on) {
                    setLinkedTaskId(null);
                    setLinkedDateKey(null);
                  }
                }}
                data-testid="note-link-switch"
              />
            </div>

            {linkTouched && (
              <div className="rounded-xl border">
                {/* Day navigation — browse back up to MAX_LOOKBACK_DAYS */}
                <div className="flex items-center justify-between border-b bg-muted/40 px-1.5 py-1.5">
                  <button
                    onClick={() => shiftBrowse(-1)}
                    disabled={browseDateKey <= minDateKey}
                    aria-label="Previous day"
                    data-testid="note-date-prev"
                    className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    data-testid="note-date-label"
                  >
                    {friendlyDayLabel(browseDateKey)}
                  </span>
                  <button
                    onClick={() => shiftBrowse(1)}
                    disabled={browseIsToday}
                    aria-label="Next day"
                    data-testid="note-date-next"
                    className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                {tasks.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No tasks yet — save the note as-is, or plan one first.
                  </p>
                ) : (
                  <ul className="max-h-[240px] overflow-y-auto overscroll-contain py-1">
                    {tasks.map((task) => (
                      <TaskPickRow
                        key={task.id}
                        task={task}
                        attempt={dayAttempts.get(task.id)}
                        browseIsToday={browseIsToday}
                        selected={linkedTaskId === task.id}
                        onPick={() => {
                          setLinkedTaskId(task.id);
                          setLinkedDateKey(browseDateKey);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Pinned footer — Review above Save: check the draft BEFORE saving */}
      <div className="shrink-0 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="mx-auto w-full max-w-md">
          {aiEnabled && canSave && (
            <DraftReviewButton online={online} onOpen={openDraftReview} />
          )}
          <button
            onClick={save}
            disabled={!canSave}
            className={cn(
              'h-12 w-full rounded-xl text-[15px] font-bold transition-transform active:scale-[0.99]',
              canSave
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                : 'bg-muted text-muted-foreground',
            )}
            data-testid="note-save"
          >
            Save note
          </button>
        </div>
      </div>

      {/* Pre-save draft review — fixes and answers flow back into the
          composer text, every change visible before Save */}
      {reviewOpen && draftReview && (
        <AiReviewSheet
          open
          onOpenChange={(o) => !o && setReviewOpen(false)}
          draft={draftReview}
          onAddAnswersToDraft={addAnswersToDraft}
          onApplyFixesToDraft={applyFixesToDraft}
          onSaveDraft={saveDraftFromReview}
        />
      )}
    </div>
  );
}

/** The pre-save review entry: secondary styling, Save stays primary. */
function DraftReviewButton({ online, onOpen }: { online: boolean; onOpen: () => void }) {
  return (
    <>
      <button
        onClick={onOpen}
        disabled={!online}
        className={cn(
          'mb-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors',
          online ? 'hover:bg-muted/60' : 'opacity-50',
        )}
        data-testid="note-review-cta"
      >
        <Sparkles className="size-4 text-primary" aria-hidden />
        Review with AI
      </button>
      {!online && (
        <p className="mb-2 text-center text-xs text-muted-foreground">
          Review needs a connection — save now, review it afterwards from the note.
        </p>
      )}
    </>
  );
}

/** One pickable task row with that day's attempt status on the right. */
function TaskPickRow({
  task,
  attempt,
  browseIsToday,
  selected,
  onPick,
}: {
  task: Task;
  attempt: DayAttempt | undefined;
  browseIsToday: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const { Icon } = iconMeta(task.icon);

  const status = (() => {
    if (attempt?.status === 'completed' && attempt.completedAt) {
      return { text: `done ${timeOfDay(attempt.completedAt)}`, tone: 'done' as const };
    }
    if (attempt?.status === 'running') {
      return { text: 'running…', tone: 'live' as const };
    }
    if (attempt?.status === 'abandoned') {
      return { text: 'not done', tone: 'muted' as const };
    }
    if (task.scheduledStart) {
      return { text: task.scheduledStart, tone: browseIsToday ? 'plan' as const : 'muted' as const };
    }
    return { text: browseIsToday ? 'anytime' : '—', tone: 'muted' as const };
  })();

  return (
    <li>
      <button
        onClick={onPick}
        aria-pressed={selected}
        data-testid={`note-task-option-${task.id}`}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
          selected ? 'bg-primary/10' : 'hover:bg-muted/60',
        )}
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundColor: taskColorMeta(task.color).hex }}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{task.title}</span>
          {task.detail && (
            <span className="block truncate text-xs text-muted-foreground">{task.detail}</span>
          )}
        </span>
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            status.tone === 'done' && 'font-semibold text-foreground',
            status.tone === 'live' && 'font-semibold text-primary',
            status.tone === 'plan' && 'text-foreground/70',
            status.tone === 'muted' && 'text-muted-foreground',
          )}
        >
          {status.text}
        </span>
      </button>
    </li>
  );
}
