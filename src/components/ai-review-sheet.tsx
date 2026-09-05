'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
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
import { ReviewError, type AiReview, type ReviewCard } from '@/lib/ai/provider';
import { friendlyDayLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * AI review — the card-stack review surface (plan §4.2).
 *
 * One finding per screen: a clarity observation (quotes the unclear spot),
 * up to two disambiguation questions, up to three suggested fixes, then a
 * summary card. The stack is swipeable with visible Back/Next fallbacks.
 * The Answer affordance is the one moment text entry happens here, so it
 * locks the stack (swipe off, nav yields to Done) and the field sits
 * directly above the keyboard. Drafts autosave per card and survive
 * close/reopen; nothing touches the note until the final card's Save,
 * which appends in one atomic write marked "added from review".
 */
export function AiReviewSheet({
  open,
  onOpenChange,
  note,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: { id: string; text: string; dateKey: string; taskTitle: string | null } | null;
}) {
  return (
    <FullScreenModal open={open} onOpenChange={onOpenChange}>
      <ModalContent data-testid="ai-review-sheet">
        {open && note && (
          <ReviewFlow key={note.id} note={note} onClose={() => onOpenChange(false)} />
        )}
      </ModalContent>
    </FullScreenModal>
  );
}

type Phase = 'loading' | 'ready' | 'error';

function ReviewFlow({
  note,
  onClose,
}: {
  note: { id: string; text: string; dateKey: string; taskTitle: string | null };
  onClose: () => void;
}) {
  const storedReview = useAppStore((s) => s.aiReviews[note.id]);
  const saveReviewAnswers = useAppStore((s) => s.saveReviewAnswers);
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

  // Answering state — the one text-entry moment inside the review surface.
  const [answerFor, setAnswerFor] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState('');

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    try {
      const outcome = await requestReview(note.id);
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
  }, [note.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (dir: 1 | -1) => {
    setAnswerFor(null);
    setIndex((i) => Math.min(summaryIndex, Math.max(0, i + dir)));
  };

  const openAnswer = (cardIndex: number) => {
    setAnswerFor(cardIndex);
    setAnswerText(review?.drafts[cardIndex] ?? '');
  };

  const closeAnswer = () => setAnswerFor(null);

  const onAnswerChange = (text: string) => {
    setAnswerText(text);
    // Draft autosave per card — quiet, reversible, survives close (plan P4).
    updateAiReviewDraft(note.id, answerFor ?? 0, text);
  };

  const answeredCount = review
    ? Object.values(review.drafts).filter((d) => d.trim()).length
    : 0;

  const saveAnswers = () => {
    if (!review) return;
    const blocks = Object.entries(review.drafts)
      .filter(([, text]) => text.trim())
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([i, answer]) => ({
        question: review.cards[Number(i)]?.type === 'question' ? review.cards[Number(i)].text : null,
        answer: answer.trim(),
      }));
    if (blocks.length === 0) return;
    saveReviewAnswers(note.id, blocks);
    toast.success(`${blocks.length} ${blocks.length === 1 ? 'answer' : 'answers'} added to your note`);
    onClose();
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

  const title = note.taskTitle ?? 'Quick note';

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <ModalTitle className="sr-only">AI review</ModalTitle>
      <ModalDescription className="sr-only">
        Wording and grammar checks for your note, one at a time
      </ModalDescription>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10">
              <Sparkles className="size-4 text-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold leading-tight">{title}</h2>
              <p className="text-xs leading-tight text-muted-foreground">
                {friendlyDayLabel(note.dateKey)}
                {cached && ' · saved review'}
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

      {/* Body — one card at a time */}
      <div
        className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col justify-center px-5 py-4"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {phase === 'loading' && <LoadingCard onCancel={onClose} />}
        {phase === 'error' && (
          <ErrorCard
            message={errorMsg}
            canRetry={canRetry}
            onRetry={() => void load()}
            onSettings={() => {
              onClose();
              setActiveTab('settings');
            }}
            onClose={onClose}
          />
        )}
        {phase === 'ready' && review && (
          <>
            {index < summaryIndex ? (
              <ReviewCardView
                card={cards[index]}
                position={index}
                total={summaryIndex}
                draft={review.drafts[index]}
                answering={answerFor === index}
                answerText={answerText}
                onAnswerOpen={() => openAnswer(index)}
                onAnswerChange={onAnswerChange}
                onAnswerDone={closeAnswer}
              />
            ) : (
              <SummaryCard
                answeredCount={answeredCount}
                alreadySaved={review.answersSavedAt !== null}
                onSave={saveAnswers}
                onClose={onClose}
              />
            )}
          </>
        )}
      </div>

      {/* Footer — dots + nav; nav yields to Done while answering (plan §4.2) */}
      {phase === 'ready' && (
        <div className="shrink-0 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <div className="mx-auto w-full max-w-md">
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
  answering,
  answerText,
  onAnswerOpen,
  onAnswerChange,
  onAnswerDone,
}: {
  card: ReviewCard;
  position: number;
  total: number;
  draft: string | undefined;
  answering: boolean;
  answerText: string;
  onAnswerOpen: () => void;
  onAnswerChange: (text: string) => void;
  onAnswerDone: () => void;
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

  return (
    <div
      className="rounded-3xl border bg-card px-5 py-6 shadow-sm"
      data-testid={`ai-card-${card.type}-${position}`}
    >
      <div className="mb-3 flex items-center justify-between">
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

      <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{card.text}</p>
      <p className="mt-4 text-xs tabular-nums text-muted-foreground">
        {position + 1} of {total + 1}
      </p>

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
            Draft saves as you type. It joins your note only when you save on the last card.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  answeredCount,
  alreadySaved,
  onSave,
  onClose,
}: {
  answeredCount: number;
  alreadySaved: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-3xl border bg-card px-5 py-6 text-center shadow-sm" data-testid="ai-summary-card">
      <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-primary/10">
        <Sparkles className="size-5 text-primary" aria-hidden />
      </span>
      {alreadySaved && answeredCount === 0 ? (
        <p className="text-[15px] font-semibold">Your answers are already in the note.</p>
      ) : (
        <p className="text-[15px] font-semibold" data-testid="ai-summary-text">
          {answeredCount === 0
            ? 'No answers to add — your note stays as written.'
            : `${answeredCount} ${answeredCount === 1 ? 'answer' : 'answers'} will be added to your note`}
        </p>
      )}
      <p className="mx-auto mt-1.5 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
        Answers join the note as your own text, each marked &ldquo;added from review&rdquo; — so the flagged spot reads clearly later.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {answeredCount > 0 && (
          <button
            onClick={onSave}
            className="h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-[0.99]"
            data-testid="ai-save-answers"
          >
            Save {answeredCount === 1 ? 'answer' : `${answeredCount} answers`} to note
          </button>
        )}
        <Button variant="outline" className="h-12 rounded-xl" onClick={onClose} data-testid="ai-review-done">
          Close
        </Button>
      </div>
    </div>
  );
}

function LoadingCard({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="rounded-3xl border bg-card px-5 py-6 shadow-sm" data-testid="ai-loading-card">
      <div className="mb-4 flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        <p className="text-sm font-medium text-muted-foreground">Checking your note…</p>
      </div>
      <div className="space-y-2.5">
        <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-8/12 animate-pulse rounded bg-muted" />
      </div>
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
  onRetry,
  onSettings,
  onClose,
}: {
  message: string;
  canRetry: boolean;
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
        Your note is untouched — reviews never change it on a failed request.
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
