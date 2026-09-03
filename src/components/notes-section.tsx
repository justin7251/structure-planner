'use client';

import { motion } from 'framer-motion';
import { useAppStore } from '@/store/use-app-store';
import { NoteCard } from '@/components/note-card';
import type { Note } from '@/types';

/**
 * Today's quick notes, newest first. Rendered on the Today page below the
 * Anytime list. Linked notes show their task anchor; standalone notes show
 * a plain "Quick note" tag. Delete is inline (shared NoteCard).
 */
export function NotesSection({ notes }: { notes: Note[] }) {
  const deleteNote = useAppStore((s) => s.deleteNote);

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
            <NoteCard note={note} onDelete={() => deleteNote(note.id)} />
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
