'use client';

import { AlarmClock, Coffee, Trophy } from 'lucide-react';
import type { Rating } from '@/types';
import { cn } from '@/lib/utils';

/** Shared visual language for the three ratings. */
export const ratingMeta: Record<
  Rating,
  { label: string; icon: typeof Trophy; chip: string; solid: string; text: string }
> = {
  excellent: {
    label: 'Excellent',
    icon: Trophy,
    chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    solid: 'bg-emerald-600 text-white border-emerald-600',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  bad: {
    label: 'Bad',
    icon: AlarmClock,
    chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25',
    solid: 'bg-amber-500 text-white border-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  lazy: {
    label: 'Lazy',
    icon: Coffee,
    chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/25',
    solid: 'bg-rose-600 text-white border-rose-600',
    text: 'text-rose-600 dark:text-rose-400',
  },
};

export function RatingChip({ rating, className }: { rating: Rating; className?: string }) {
  const meta = ratingMeta[rating];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        meta.chip,
        className
      )}
    >
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}
