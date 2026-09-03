'use client';

import { Link2, NotebookPen, Trash2 } from 'lucide-react';
import { friendlyDayLabel, timeOfDay, todayKey } from '@/lib/format';
import type { Note } from '@/types';

export type NoteOutcome = 'done' | 'missed';

/**
 * Shared note card — one visual shape for a saved note everywhere it
 * appears (Today's notes list, the Week review panel). Full text always
 * renders; the meta row shows the task anchor (or "Quick note"), the
 * capture time, and — when the caller knows it — whether the linked
 * task ended up done or missed. Delete stays inline: notes are tiny,
 * low-stakes artifacts, a confirm would cost more than it saves.
 */
export function NoteCard({
  note,
  onDelete,
  outcome = null,
  testidPrefix = 'note-item',
}: {
  note: Note;
  onDelete: () => void;
  /** Whether the linked task was completed that day (Week review only). */
  outcome?: NoteOutcome | null;
  /** data-testid namespace, so each surface keeps its own hooks. */
  testidPrefix?: string;
}) {
  return (
    <div
      className="group relative rounded-2xl border bg-card/60 px-3.5 py-3"
      data-testid={`${testidPrefix}-${note.id}`}
    >
      <p className="whitespace-pre-wrap pr-9 text-sm leading-relaxed">{note.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {note.taskId && note.taskTitle ? (
          <>
            <Link2 className="size-3 shrink-0" aria-hidden />
            <span className="max-w-[220px] truncate font-medium text-foreground/75">
              {note.taskTitle}
            </span>
            {outcome === 'done' && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                Done
              </span>
            )}
            {outcome === 'missed' && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-400">
                Not done
              </span>
            )}
            {note.taskDateKey && note.taskDateKey !== todayKey() && (
              <span className="shrink-0">({friendlyDayLabel(note.taskDateKey)})</span>
            )}
            <span aria-hidden>·</span>
          </>
        ) : (
          <>
            <NotebookPen className="size-3 shrink-0" aria-hidden />
            <span>Quick note</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="tabular-nums">{timeOfDay(note.createdAt)}</span>
      </div>
      <button
        onClick={onDelete}
        aria-label={`Delete note: ${note.text.slice(0, 40)}`}
        data-testid={`${testidPrefix}-delete-${note.id}`}
        className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-md text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
