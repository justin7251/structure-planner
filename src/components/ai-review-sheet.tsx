'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageCircleQuestion,
  Eye,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import {
  FullScreenModal,
  ModalContent,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/full-screen-modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store/use-app-store';
import { requestReview } from '@/lib/ai/review-client';
import {
  ReviewError,
  type AiReview,
  type ReviewAnswerBlock,
  type ReviewCard,
  type ReviewFixEdit,
} from '@/lib/ai/provider';
import { friendlyDayLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * AI review — the review surface (plan §4.2).
 *
 * Two targets, one flow:
 *   • Pre-save draft (primary entry, plan §4.1): reviews the composer's
 *     unsaved text. Suggested fixes land in the draft only by explicit user
 *     tap — Apply on a card, or Apply all suggestions — and typed answers
 *     are appended on request, so the user sees every change BEFORE saving.
 *     Nothing here is persisted; a draft has nothing to persist against.
 *   • Saved note (notes-section entry): the same surface on the stored text;
 *     applies write through the store in one atomic batch (and are stamped
 *     on the review, so they survive close/reopen), answers append marked
 *     "added from review".
 *
 * Presentation follows the load (plan §4.2): 1–3 findings render as the
 * guided stack — one card at a time, swipeable, Back/Next fallbacks — while
 * 4+ render as a single skimmable report with actions at the end. A five-step
 * tour is a chore; a five-item list gets read.
 *
 * Suggestions are APPLICABLE (prompt v3): each carries find → replaceWith,
 * rendered as a before/after diff box with an Apply button, and the quoted
 * spot is highlighted live in the pinned draft strip — stack mode follows
 * the focused card, report mode highlights on tap of the diff box. The
 * summary card is a completion state, not an apology: "Review complete" +
 * what changed + the two decisions that matter (apply-all; for drafts, the
 * Back-to-editing vs primary Save-draft pair). On md+ screens the surface
 * goes two-column — the user's own text on the left, the findings on the
 * right — so the draft keeps its prominence instead of shrinking to a strip.
 *
 * The note's own text stays pinned (it collapses only while an answer field
 * is open on mobile, where the keyboard needs the room). Drafts autosave per
 * answer card (store-backed for saved notes, in-memory for drafts). The
 * review itself never edits the target — the user does, one approved edit
 * at a time.
 */

/** A pre-save draft review target — text that is not in the store yet. */
export interface ReviewDraftTarget {
  text: string;
  taskId: string | null;
  /** Linked task's day, or today for a quick note. */
  dateKey: string;
  /** Per-open identity — the sheet's mount key. Applied fixes flow through
   *  `text` without touching it; only a NEW open mints a new seq. */
  seq: number;
}

/** A saved-note review target — everything the store path needs. */
interface SavedNoteTarget {
  id: string;
  text: string;
  dateKey: string;
  taskId: string | null;
  taskDateKey: string | null;
  taskTitle: string | null;
}

export function AiReviewSheet({
  open,
  onOpenChange,
  note,
  draft,
  onAddAnswersToDraft,
  onApplyFixesToDraft,
  onSaveDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saved-note review — cached by content hash, persisted with the note. */
  note?: {
    id: string;
    text: string;
    dateKey: string;
    taskId: string | null;
    taskDateKey?: string | null;
    taskTitle: string | null;
  } | null;
  /** Pre-save draft review — runs on the unsaved text, never persisted. */
  draft?: ReviewDraftTarget | null;
  /** Draft mode only: append typed answers into the composer draft. */
  onAddAnswersToDraft?: (blocks: ReviewAnswerBlock[]) => void;
  /** Draft mode only: apply user-approved fixes into the composer draft. */
  onApplyFixesToDraft?: (edits: ReviewFixEdit[]) => void;
  /** Draft mode only: save the composer draft as-is and close the review. */
  onSaveDraft?: () => void;
}) {
  return (
    <FullScreenModal open={open} onOpenChange={onOpenChange}>
      <ModalContent data-testid="ai-review-sheet">
        {open && note && (
          <ReviewFlow key={note.id} saved={note} onClose={() => onOpenChange(false)} />
        )}
        {open && !note && draft && (
          <ReviewFlow
            key={`draft-${draft.seq}`}
            draftTarget={draft}
            onAddAnswersToDraft={onAddAnswersToDraft}
            onApplyFixesToDraft={onApplyFixesToDraft}
            onSaveDraft={onSaveDraft}
            onClose={() => onOpenChange(false)}
          />
        )}
      </ModalContent>
    </FullScreenModal>
  );
}

type Phase = 'loading' | 'ready' | 'error';

function ReviewFlow({
  saved,
  draftTarget,
  onAddAnswersToDraft,
  onApplyFixesToDraft,
  onSaveDraft,
  onClose,
}: {
  saved?: {
    id: string;
    text: string;
    dateKey: string;
    taskId: string | null;
    taskDateKey?: string | null;
    taskTitle: string | null;
  } | null;
  draftTarget?: ReviewDraftTarget | null;
  onAddAnswersToDraft?: (blocks: ReviewAnswerBlock[]) => void;
  onApplyFixesToDraft?: (edits: ReviewFixEdit[]) => void;
  onSaveDraft?: () => void;
  onClose: () => void;
}) {
  const isDraft = !saved;
  const noteWord = isDraft ? 'draft' : 'note';

  // Draft answers live in component state — without a note id there is
  // nothing to persist against; they die with the sheet (plan §6.2).
  const [localDrafts, setLocalDrafts] = useState<Record<number, string>>({});
  // Applied-fix stamps for drafts — same story, nothing to persist against.
  // Saved notes read the store's appliedFixes instead (survives reopen).
  const [draftApplied, setDraftApplied] = useState<Record<number, string>>({});

  const storedReview = useAppStore((s) => (saved ? s.aiReviews[saved.id] : undefined));
  const saveReviewAnswers = useAppStore((s) => s.saveReviewAnswers);
  const applyReviewFixesToNote = useAppStore((s) => s.applyReviewFixesToNote);
  const updateAiReviewDraft = useAppStore((s) => s.updateAiReviewDraft);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const [phase, setPhase] = useState<Phase>('loading');
  const [fetched, setFetched] = useState<AiReview | null>(null);
  // Render from the STORE object when present — draft autosaves land there,
  // so markers and answer counts stay reactive (a local snapshot would go stale).
  const review = storedReview ?? fetched;
  const [errorMsg, setErrorMsg] = useState('');
  const [canRetry, setCanRetry] = useState(true);
  const [cached, setCached] = useState(false);

  // Card position — the last position is the summary card.
  const cards = review?.cards ?? [];
  const summaryIndex = cards.length;
  const [index, setIndex] = useState(0);

  // Adaptive surface (plan §4.2): a short note yields 1–3 findings, which
  // deserve the focused stack; 4+ findings (a long pasted text) become a
  // skimmable report — nobody finishes a 5-step tour, but everyone reads a
  // 5-item list. Same cards, same answer flow, different presentation.
  const listMode = cards.length >= 4;

  // Answering state — the one text-entry moment inside the review surface.
  const [answerFor, setAnswerFor] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState('');

  // The spot currently highlighted in the pinned text strip. The cards quote
  // spots FROM this text, so the connection is shown, not implied: stack
  // mode follows the focused card automatically; report mode highlights
  // when the user taps a fix's diff box.
  const [highlightFind, setHighlightFind] = useState<string | null>(null);

  // The LIVE target text: an applied fix lands in the composer draft (the
  // parent updates draftTarget.text) or in the stored note (store write) —
  // either way this re-renders showing the edited wording.
  const targetText = saved?.text ?? draftTarget?.text ?? '';

  const applied = isDraft ? draftApplied : (review?.appliedFixes ?? {});
  const fixesAppliedCount = Object.keys(applied).length;

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Snapshot the review target ONCE, at mount. Load must never re-run just
  // because an applied fix changed the draft text (and with it the prop
  // identity) — the sheet remounts per open, so a mount-time snapshot is
  // always the text the user asked to review.
  const targetRef = useRef({ saved, draftTarget });

  const load = useCallback(async () => {
    const { saved, draftTarget } = targetRef.current;
    setPhase('loading');
    setErrorMsg('');
    try {
      const outcome = await requestReview(
        saved
          ? {
              text: saved.text,
              taskId: saved.taskId,
              dateKey: saved.taskDateKey ?? saved.dateKey,
              noteId: saved.id,
            }
          : {
              text: draftTarget!.text,
              taskId: draftTarget!.taskId,
              dateKey: draftTarget!.dateKey,
            },
      );
      if (!aliveRef.current) return;
      setFetched(outcome.review);
      setCached(outcome.cached);
      setIndex(0);
      setPhase('ready');
    } catch (err) {
      if (!aliveRef.current) return;
      const code = err instanceof ReviewError ? err.code : 'provider';
      const message =
        err instanceof ReviewError ? err.message : 'Something went wrong. Try again.';
      setErrorMsg(message);
      setCanRetry(code !== 'provider' || !message.includes("today's reviews"));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (dir: 1 | -1) => {
    setAnswerFor(null);
    setIndex((i) => Math.min(summaryIndex, Math.max(0, i + dir)));
  };

  const openAnswer = (cardIndex: number) => {
    setAnswerFor(cardIndex);
    setAnswerText((isDraft ? localDrafts[cardIndex] : review?.drafts[cardIndex]) ?? '');
  };

  const closeAnswer = () => setAnswerFor(null);

  const onAnswerChange = (text: string) => {
    setAnswerText(text);
    // Draft autosave per card — quiet, reversible (plan P4). Store-backed
    // for saved notes, in-memory for drafts (nothing to persist against).
    if (isDraft) {
      const i = answerFor ?? 0;
      setLocalDrafts((d) => ({ ...d, [i]: text }));
    } else {
      updateAiReviewDraft(saved!.id, answerFor ?? 0, text);
    }
  };

  // One typed source for both modes keeps the entries callbacks simple.
  const answerDrafts: Record<number, string> = isDraft ? localDrafts : (review?.drafts ?? {});

  const answeredCount = Object.values(answerDrafts).filter((d) => d.trim()).length;

  const commitAnswers = () => {
    if (!review) return;
    const blocks = Object.entries(answerDrafts)
      .filter(([, text]) => text.trim())
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([i, answer]) => ({
        question: review.cards[Number(i)]?.type === 'question' ? review.cards[Number(i)].text : null,
        answer: answer.trim(),
      }));
    if (blocks.length === 0) return;
    const n = blocks.length;
    if (isDraft) {
      onAddAnswersToDraft?.(blocks);
      toast.success(
        `${n} ${n === 1 ? 'answer' : 'answers'} added to your draft — review it, then save`,
      );
    } else {
      saveReviewAnswers(saved!.id, blocks);
      toast.success(`${n} ${n === 1 ? 'answer' : 'answers'} added to your note`);
    }
    onClose();
  };

  // ── applying fixes (v1.9) — always user-tapped, one approved edit at a time ──

  const applyEdits = (edits: ReviewFixEdit[]) => {
    if (edits.length === 0) return;
    if (isDraft) {
      onApplyFixesToDraft?.(edits);
      const nowIso = new Date().toISOString();
      setDraftApplied((a) => {
        const next = { ...a };
        for (const e of edits) next[e.cardIndex] = nowIso;
        return next;
      });
    } else {
      applyReviewFixesToNote(saved!.id, edits);
    }
    toast.success(
      `${edits.length} ${edits.length === 1 ? 'fix' : 'fixes'} applied to your ${noteWord}`,
    );
  };

  const applyFix = (cardIndex: number) => {
    const card = cards[cardIndex];
    if (card.type !== 'suggestion' || !card.find || !card.replaceWith) return;
    applyEdits([{ cardIndex, find: card.find, replaceWith: card.replaceWith }]);
  };

  // Suggestions still applicable: structured fix, not yet applied, and the
  // quoted spot still present in the current text. Feeds Apply all.
  const unappliedFixes: ReviewFixEdit[] = [];
  cards.forEach((card, i) => {
    if (
      card.type === 'suggestion' &&
      card.find &&
      card.replaceWith &&
      !applied[i] &&
      targetText.includes(card.find)
    ) {
      unappliedFixes.push({ cardIndex: i, find: card.find, replaceWith: card.replaceWith });
    }
  });

  // Stack mode: the highlight follows the focused card. Recomputed from the
  // LIVE text, so an applied fix clears its own highlight (its spot is gone).
  useEffect(() => {
    if (listMode || phase !== 'ready') return;
    const find = cards[index]?.find;
    setHighlightFind(find && targetText.includes(find) ? find : null);
  }, [listMode, phase, index, cards, targetText]);

  // Report mode: highlight on explicit tap of a fix's diff box.
  const locate = (find: string | null) => {
    if (!find) return;
    setHighlightFind(find);
  };

  // Swipe navigation — locked while the answer field is open (plan §4.2).
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (answerFor !== null) return;
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (answerFor !== null || touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 48) return;
    go(dx < 0 ? 1 : -1);
  };

  const title = saved?.taskTitle ?? (isDraft ? 'Draft' : 'Quick note');

  // Status line — the state of the document at a glance (v1.9): no
  // discovering findings by scrolling.
  const suggestionCount = cards.filter((c) => c.type === 'suggestion').length;
  const questionCount = cards.filter((c) => c.type === 'question').length;
  const observationCount = cards.filter((c) => c.type === 'observation').length;
  const statusParts = [
    suggestionCount
      ? `${suggestionCount} ${suggestionCount === 1 ? 'suggestion' : 'suggestions'}`
      : null,
    questionCount ? `${questionCount} ${questionCount === 1 ? 'question' : 'questions'}` : null,
    observationCount ? `${observationCount} ${observationCount === 1 ? 'issue' : 'issues'}` : null,
  ].filter(Boolean) as string[];
  const statusText = statusParts.length
    ? `Review complete · ${statusParts.join(' · ')}`
    : 'Review complete';

  const onSaveDraftFromReview = () => {
    if (onSaveDraft) onSaveDraft();
    else onClose();
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <ModalTitle className="sr-only">AI review</ModalTitle>
      <ModalDescription className="sr-only">
        Suggestions and clarity checks for your {noteWord}
      </ModalDescription>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between md:max-w-3xl">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10">
              <Sparkles className="size-4 text-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold leading-tight">{title}</h2>
              <p className="text-xs leading-tight text-muted-foreground">
                {isDraft ? 'Draft — not saved yet' : friendlyDayLabel(saved!.dateKey)}
                {!isDraft && cached && ' · saved review'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close review"
            data-testid="ai-review-close"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Body — draft column + findings column. Mobile: the draft pinned
          above the findings; md+: side-by-side (draft left, findings right),
          each column scrolling on its own. */}
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pb-4 md:grid md:max-w-3xl md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-6 md:px-6">
        {/* Draft column — status line + the user's own text, with the
            highlighted spot marked live. */}
        <div
          className={cn(
            'shrink-0 pt-3 md:order-1 md:min-h-0 md:overflow-y-auto md:pt-4',
            answerFor !== null && 'hidden md:block',
          )}
        >
          {phase === 'ready' && (
            <p
              className="text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:text-left"
              data-testid="ai-review-status"
            >
              {statusText}
            </p>
          )}
          {phase === 'ready' && (
            <div className="mt-2 rounded-2xl border bg-muted/30 px-3.5 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Your {noteWord}
              </p>
              <DraftHighlight
                text={targetText}
                find={highlightFind}
                testId="ai-review-original-text"
              />
            </div>
          )}
        </div>

        {/* Findings column — guided stack (1–3) or skimmable report (4+) */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col pt-3 md:order-2 md:min-h-0 md:overflow-y-auto md:pt-4',
            listMode ? 'justify-start overflow-y-auto overscroll-contain' : 'justify-center',
          )}
          onTouchStart={listMode ? undefined : onTouchStart}
          onTouchEnd={listMode ? undefined : onTouchEnd}
        >
          {phase === 'loading' && <LoadingCard targetWord={noteWord} onCancel={onClose} />}
          {phase === 'error' && (
            <ErrorCard
              message={errorMsg}
              canRetry={canRetry}
              targetWord={noteWord}
              onRetry={() => void load()}
              onSettings={() => {
                onClose();
                setActiveTab('settings');
              }}
              onClose={onClose}
            />
          )}
          {phase === 'ready' && review && (
            listMode ? (
              <div className="space-y-2.5">
                {cards.map((card, i) => (
                  <ReviewCardView
                    key={`${card.type}-${i}`}
                    card={card}
                    position={i}
                    total={summaryIndex}
                    compact
                    draft={isDraft ? localDrafts[i] : review.drafts[i]}
                    targetWord={noteWord}
                    answering={answerFor === i}
                    answerText={answerText}
                    onAnswerOpen={() => openAnswer(i)}
                    onAnswerChange={onAnswerChange}
                    onAnswerDone={closeAnswer}
                    applied={!!applied[i]}
                    findable={!!card.find && !!card.replaceWith && targetText.includes(card.find)}
                    onApply={() => applyFix(i)}
                    onLocate={() => locate(card.find ?? null)}
                  />
                ))}
                <SummaryCard
                  answeredCount={answeredCount}
                  alreadySaved={!isDraft && review.answersSavedAt !== null}
                  fixesAppliedCount={fixesAppliedCount}
                  applyAllCount={unappliedFixes.length}
                  isDraft={isDraft}
                  targetWord={noteWord}
                  onSave={commitAnswers}
                  onApplyAll={() => applyEdits(unappliedFixes)}
                  onSaveDraft={isDraft ? onSaveDraftFromReview : undefined}
                  onClose={onClose}
                />
              </div>
            ) : (
              <>
                {index < summaryIndex ? (
                  <ReviewCardView
                    card={cards[index]}
                    position={index}
                    total={summaryIndex}
                    draft={isDraft ? localDrafts[index] : review.drafts[index]}
                    targetWord={noteWord}
                    answering={answerFor === index}
                    answerText={answerText}
                    onAnswerOpen={() => openAnswer(index)}
                    onAnswerChange={onAnswerChange}
                    onAnswerDone={closeAnswer}
                    applied={!!applied[index]}
                    findable={
                      !!cards[index].find &&
                      !!cards[index].replaceWith &&
                      targetText.includes(cards[index].find!)
                    }
                    onApply={() => applyFix(index)}
                    onLocate={() => locate(cards[index].find ?? null)}
                  />
                ) : (
                  <SummaryCard
                    answeredCount={answeredCount}
                    alreadySaved={!isDraft && review.answersSavedAt !== null}
                    fixesAppliedCount={fixesAppliedCount}
                    applyAllCount={unappliedFixes.length}
                    isDraft={isDraft}
                    targetWord={noteWord}
                    onSave={commitAnswers}
                    onApplyAll={() => applyEdits(unappliedFixes)}
                    onSaveDraft={isDraft ? onSaveDraftFromReview : undefined}
                    onClose={onClose}
                  />
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* Footer — stack mode: dots + nav; nav yields to Done while answering.
          Report mode: no tour to navigate — only an open answer field gets a
          Done bar (answers autosave; the report's actions live at its end). */}
      {phase === 'ready' && !listMode && (
        <div className="shrink-0 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <div className="mx-auto w-full max-w-md md:max-w-3xl">
            {answerFor !== null ? (
              <button
                onClick={closeAnswer}
                className="h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-[0.99]"
                data-testid="ai-answer-done"
              >
                Done
              </button>
            ) : (
              <>
                <div className="mb-2.5 flex items-center justify-center gap-1.5">
                  {Array.from({ length: summaryIndex + 1 }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'size-1.5 rounded-full transition-colors',
                        i === index ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-12 flex-1 rounded-xl"
                    onClick={() => go(-1)}
                    disabled={index === 0}
                    data-testid="ai-review-back"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    Back
                  </Button>
                  <Button
                    className="h-12 flex-1 rounded-xl"
                    onClick={() => go(1)}
                    disabled={index >= summaryIndex}
                    data-testid="ai-review-next"
                  >
                    {index + 1 === summaryIndex ? 'Summary' : 'Next'}
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {phase === 'ready' && listMode && answerFor !== null && (
        <div className="shrink-0 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <div className="mx-auto w-full max-w-md md:max-w-3xl">
            <button
              onClick={closeAnswer}
              className="h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-[0.99]"
              data-testid="ai-answer-done"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CARD_META: Record<
  ReviewCard['type'],
  { label: string; icon: typeof Eye; chip: string }
> = {
  observation: {
    label: 'Clarity',
    icon: Eye,
    chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  question: {
    label: 'Question',
    icon: MessageCircleQuestion,
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  suggestion: {
    label: 'Suggested fix',
    icon: Lightbulb,
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
};

function ReviewCardView({
  card,
  position,
  total,
  draft,
  targetWord,
  answering,
  answerText,
  onAnswerOpen,
  onAnswerChange,
  onAnswerDone,
  applied,
  findable,
  onApply,
  onLocate,
  compact = false,
}: {
  card: ReviewCard;
  position: number;
  total: number;
  draft: string | undefined;
  targetWord: 'note' | 'draft';
  answering: boolean;
  answerText: string;
  onAnswerOpen: () => void;
  onAnswerChange: (text: string) => void;
  onAnswerDone: () => void;
  /** A user-approved fix already landed for this card. */
  applied: boolean;
  /** The quoted spot is still present in the live text — Apply is possible. */
  findable: boolean;
  onApply: () => void;
  /** Tap the diff box → highlight the spot in the draft strip. */
  onLocate: () => void;
  /** Report mode (plan §4.2): denser card, no step counter — a list row,
   *  not a tour stop. */
  compact?: boolean;
}) {
  const meta = CARD_META[card.type];
  const Icon = meta.icon;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (answering) {
      // Field expands directly above the keyboard — focus after the layout settles.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [answering]);

  const hasFix = card.type === 'suggestion' && !!card.find && !!card.replaceWith;

  return (
    <div
      className={cn(
        'rounded-3xl border bg-card shadow-sm',
        compact ? 'px-4 py-3.5' : 'px-5 py-6',
      )}
      data-testid={`ai-card-${card.type}-${position}`}
    >
      <div className={cn('flex items-center justify-between', compact ? 'mb-2' : 'mb-3')}>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
            meta.chip,
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {meta.label}
        </span>
        {draft?.trim() && !answering && (
          <span className="text-[11px] font-medium text-muted-foreground" data-testid="ai-draft-marker">
            Draft saved
          </span>
        )}
      </div>

      <p
        className={cn(
          'whitespace-pre-wrap leading-relaxed',
          compact ? 'text-[15px]' : 'text-[17px]',
        )}
      >
        {card.text}
      </p>

      {/* Before → after — the recommendation, scannable without reading prose
          (v1.9). Tapping it highlights the spot in the pinned draft strip. */}
      {hasFix && (
        <button
          type="button"
          onClick={onLocate}
          className="mt-3 block w-full overflow-hidden rounded-xl border text-left transition-colors hover:border-foreground/25"
          aria-label="Show this spot in your draft"
          data-testid={`ai-fix-diff-${position}`}
        >
          <span className="flex items-start gap-2 bg-rose-500/[0.07] px-3 py-2">
            <span aria-hidden className="shrink-0 font-bold leading-snug text-rose-500/90">
              −
            </span>
            <span className="break-words text-[13px] leading-snug text-muted-foreground line-through decoration-rose-400/50">
              {card.find}
            </span>
          </span>
          <span className="flex items-start gap-2 border-t bg-emerald-500/[0.08] px-3 py-2">
            <span
              aria-hidden
              className="shrink-0 font-bold leading-snug text-emerald-600 dark:text-emerald-400"
            >
              +
            </span>
            <span className="break-words text-[13px] font-medium leading-snug">
              {card.replaceWith}
            </span>
          </span>
        </button>
      )}

      {/* Apply — the fix lands only by explicit tap (v1.9). After applying,
          the button becomes a stamped receipt; if the spot is gone from the
          text, applying is disabled rather than guessing a placement. */}
      {hasFix &&
        (applied ? (
          <span
            className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm font-semibold text-emerald-700 dark:text-emerald-400"
            data-testid={`ai-apply-${position}`}
          >
            <Check className="size-4" aria-hidden />
            Applied
          </span>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={!findable}
            title={findable ? undefined : 'That text is no longer in your draft'}
            className={cn(
              'mt-3 flex h-10 w-full items-center justify-center rounded-xl text-sm font-bold transition-transform active:scale-[0.99]',
              findable
                ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                : 'bg-muted text-muted-foreground',
            )}
            data-testid={`ai-apply-${position}`}
          >
            Apply fix
          </button>
        ))}

      {!compact && (
        <p className="mt-4 text-xs tabular-nums text-muted-foreground">
          {position + 1} of {total + 1}
        </p>
      )}

      {card.type === 'question' && !answering && (
        <button
          onClick={onAnswerOpen}
          className="mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold text-foreground/80 transition-colors hover:bg-muted/60"
          data-testid="ai-answer-open"
        >
          <MessageCircleQuestion className="size-4" aria-hidden />
          {draft?.trim() ? 'Edit your answer' : 'Answer'}
        </button>
      )}

      {answering && (
        <div className="mt-4">
          <Textarea
            ref={inputRef}
            value={answerText}
            onChange={(e) => onAnswerChange(e.target.value)}
            placeholder="Your answer — in your own words"
            rows={3}
            aria-label="Your answer"
            className="resize-none"
            data-testid="ai-answer-input"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Saves as you type — nothing joins your {targetWord} until you add it.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  answeredCount,
  alreadySaved,
  fixesAppliedCount,
  applyAllCount,
  isDraft,
  targetWord,
  onSave,
  onApplyAll,
  onSaveDraft,
  onClose,
}: {
  answeredCount: number;
  alreadySaved: boolean;
  fixesAppliedCount: number;
  /** Suggestions still applicable — Apply all appears at 2 or more. */
  applyAllCount: number;
  isDraft: boolean;
  targetWord: 'note' | 'draft';
  onSave: () => void;
  onApplyAll: () => void;
  onSaveDraft?: () => void;
  onClose: () => void;
}) {
  const answersPending = answeredCount > 0 && !alreadySaved;

  // State of the document, in one line — never "No answers to add" (v1.9):
  // a review that finds nothing to change is still a completed review.
  const stateLine = [
    fixesAppliedCount > 0
      ? `${fixesAppliedCount} ${fixesAppliedCount === 1 ? 'fix' : 'fixes'} applied to your ${targetWord}`
      : `Your ${targetWord} hasn't been changed`,
    answersPending
      ? `${answeredCount} ${answeredCount === 1 ? 'answer' : 'answers'} waiting to be added`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const support = answersPending
    ? `Answers join the ${targetWord} as your own text, marked “added from review” — add them, or save without them.`
    : fixesAppliedCount > 0
      ? isDraft
        ? 'The fixes above are in your draft — save it to keep them.'
        : 'The fixes above are already in your note.'
      : isDraft
        ? 'Review the suggestions above, or save your draft as written.'
        : 'Review the suggestions above, or close when you are done.';

  return (
    <div
      className="rounded-3xl border bg-card px-5 py-6 text-center shadow-sm"
      data-testid="ai-summary-card"
    >
      <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-primary/10">
        <Sparkles className="size-5 text-primary" aria-hidden />
      </span>
      {alreadySaved && answeredCount === 0 ? (
        <p className="text-[15px] font-semibold">
          Your answers are already in the {targetWord}.
        </p>
      ) : (
        <p className="text-[15px] font-semibold" data-testid="ai-summary-text">
          Review complete
        </p>
      )}
      <p className="mt-1 text-xs font-medium text-muted-foreground" data-testid="ai-summary-state">
        {stateLine}
      </p>
      <p className="mx-auto mt-1.5 max-w-[300px] text-xs leading-relaxed text-muted-foreground">
        {support}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {answersPending && (
          <button
            onClick={onSave}
            className="h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-[0.99]"
            data-testid="ai-save-answers"
          >
            {targetWord === 'draft'
              ? `Add ${answeredCount === 1 ? '1 answer' : `${answeredCount} answers`} to draft`
              : `Save ${answeredCount === 1 ? '1 answer' : `${answeredCount} answers`} to note`}
          </button>
        )}
        {applyAllCount >= 2 && (
          <button
            onClick={onApplyAll}
            className="h-12 w-full rounded-xl border border-emerald-600/40 bg-emerald-500/10 text-[15px] font-bold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
            data-testid="ai-apply-all"
          >
            Apply all suggestions
          </button>
        )}
        {isDraft ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-12 flex-1 rounded-xl"
              onClick={onClose}
              data-testid="ai-review-done"
            >
              Back to editing
            </Button>
            <button
              onClick={onSaveDraft}
              className="h-12 flex-1 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-[0.99]"
              data-testid="ai-save-draft"
            >
              Save draft
            </button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="h-12 rounded-xl"
            onClick={onClose}
            data-testid="ai-review-done"
          >
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The pinned draft text with the current spot highlighted. The mark gives
 * the card↔draft connection a physical anchor; scrolling follows it inside
 * the strip (block: nearest — nothing else on the page should move).
 */
function DraftHighlight({
  text,
  find,
  testId,
}: {
  text: string;
  find: string | null;
  testId?: string;
}) {
  const markRef = useRef<HTMLElement | null>(null);
  const hit = find ? text.indexOf(find) : -1;

  useEffect(() => {
    if (hit >= 0) {
      markRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [hit, find]);

  const pClass =
    'mt-1 max-h-24 overflow-y-auto overscroll-contain whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90 md:max-h-[420px]';

  if (find && hit >= 0) {
    return (
      <p className={pClass} data-testid={testId}>
        {text.slice(0, hit)}
        <mark
          ref={markRef}
          className="rounded-[3px] bg-amber-300/70 text-inherit transition-colors dark:bg-amber-400/25"
        >
          {find}
        </mark>
        {text.slice(hit + find.length)}
      </p>
    );
  }
  return (
    <p className={pClass} data-testid={testId}>
      {text}
    </p>
  );
}

function LoadingCard({ targetWord, onCancel }: { targetWord: 'note' | 'draft'; onCancel: () => void }) {
  // Elapsed ticker — a review through a slow endpoint can legitimately run
  // past 30s (transport v2 streams, so the wait means progress, not a hang).
  // A visible clock turns a silent wait into an honest one, and the hint
  // sets the expectation BEFORE the user decides the request is dead.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-3xl border bg-card px-5 py-6 shadow-sm" data-testid="ai-loading-card">
      <div className="mb-4 flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        <p className="text-sm font-medium text-muted-foreground">Checking your {targetWord}…</p>
        <span
          className="ml-auto text-xs tabular-nums text-muted-foreground/70"
          data-testid="ai-loading-elapsed"
        >
          {elapsed}s
        </span>
      </div>
      <div className="space-y-2.5">
        <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-8/12 animate-pulse rounded bg-muted" />
      </div>
      {elapsed >= 10 && (
        <p
          className="mt-4 text-[11px] leading-relaxed text-muted-foreground"
          data-testid="ai-loading-slow-hint"
        >
          Still working — a long text can take up to a minute. You can keep this open, or cancel and try again.
        </p>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Nothing changes on its own — you see every fix and decide.
      </p>
      <button
        onClick={onCancel}
        className="mt-5 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        data-testid="ai-loading-cancel"
      >
        Cancel
      </button>
    </div>
  );
}

function ErrorCard({
  message,
  canRetry,
  targetWord,
  onRetry,
  onSettings,
  onClose,
}: {
  message: string;
  canRetry: boolean;
  targetWord: 'note' | 'draft';
  onRetry: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const isConfig = message.toLowerCase().includes('key');
  return (
    <div className="rounded-3xl border bg-card px-5 py-6 text-center shadow-sm" data-testid="ai-error-card">
      <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-amber-500/10">
        <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
      </span>
      <p className="text-sm font-medium" data-testid="ai-error-message">
        {message}
      </p>
      <p className="mx-auto mt-1.5 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
        Your {targetWord} is untouched — reviews never change it on a failed request.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {isConfig && (
          <Button className="h-11 rounded-xl" onClick={onSettings} data-testid="ai-open-settings">
            <Settings className="size-4" aria-hidden />
            Open Settings
          </Button>
        )}
        {canRetry && (
          <Button variant="outline" className="h-11 rounded-xl" onClick={onRetry} data-testid="ai-retry">
            Retry
          </Button>
        )}
        <Button variant="ghost" className="h-11 rounded-xl" onClick={onClose} data-testid="ai-error-close">
          Close
        </Button>
      </div>
    </div>
  );
}
