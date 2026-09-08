'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/use-app-store';
import { NoteCard } from '@/components/note-card';
import { AiReviewSheet } from '@/components/ai-review-sheet';
import type { Note } from '@/types';

/**
 * Today's quick notes, newest first. Rendered on the Today page below the
 * Anytime list. Linked notes show their task anchor; standalone notes show
 * a plain "Quick note" tag. Delete is inline (shared NoteCard). When AI
 * review is enabled, each card also carries the secondary "Review" entry
 * point (plan §4.1) — the same flow as the composer's pre-save check, run
 * on this saved note; answers append to the note as the user's own text.
 */
export function NotesSection({ notes }: { notes: Note[] }) {
  const deleteNote = useAppStore((s) => s.deleteNote);
  const aiEnabled = useAppStore((s) => s.aiEnabled);
  const storedNotes = useAppStore((s) => s.notes);
  const [reviewNote, setReviewNote] = useState<Note | null>(null);

  // The review sheet reads note.text reactively — applied fixes write to the
  // store, and this keeps the sheet's pinned text on the CURRENT wording
  // (a state snapshot would go stale the moment a fix lands).
  const liveReviewNote = reviewNote ? (storedNotes[reviewNote.id] ?? reviewNote) : null;

  if (notes.length === 0) return null;

  return (
    <section className="mt-5" aria-label="Notes" data-testid="notes-section">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notes
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{notes.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {notes.map((note, i) => (
          <motion.li
            key={note.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.15) }}
          >
            <NoteCard
              note={note}
              onDelete={() => deleteNote(note.id)}
              onReview={aiEnabled ? () => setReviewNote(note) : undefined}
            />
          </motion.li>
        ))}
      </ul>

      <AiReviewSheet
        open={reviewNote !== null}
        onOpenChange={(o) => !o && setReviewNote(null)}
        note={liveReviewNote}
      />
    </section>
  );
}
