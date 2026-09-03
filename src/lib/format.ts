import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

/** "1h 23m" / "12m" / "45s" — human duration for rows and summaries. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

/** Live timer clock: "12:34" or "1:02:07". */
export function formatClock(totalMs: number): string {
  const s = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Local day bucket key "yyyy-MM-dd". Date-only strings pass through
 *  (they ARE local day keys); full ISO timestamps are formatted in local
 *  time. Never parse a date-only key with parseISO — it anchors to UTC
 *  midnight, which formats back a day earlier west of Greenwich. */
export function dateKeyOf(date: Date | string): string {
  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    return format(parseISO(date), 'yyyy-MM-dd');
  }
  return format(date, 'yyyy-MM-dd');
}

/** Parse a "yyyy-MM-dd" key as a LOCAL date (midnight in the device
 *  timezone). The one canonical parser for day keys — planDayLabel,
 *  friendlyDayLabel and the calendar views all share it. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayKey(): string {
  return dateKeyOf(new Date());
}

export function tomorrowKey(): string {
  return dateKeyOf(addDays(new Date(), 1));
}

/**
 * Day label for future plans: Today / Tomorrow / weekday (within a week) /
 * "Fri 25 Sep" beyond that. Complements friendlyDayLabel (past-oriented).
 */
export function planDayLabel(key: string): string {
  if (key === todayKey()) return 'Today';
  if (key === tomorrowKey()) return 'Tomorrow';
  const d = parseDayKey(key);
  const diff = differenceInCalendarDays(d, new Date());
  if (diff > 1 && diff < 7) return format(d, 'EEEE');
  return format(d, 'EEE d MMM');
}

/** "HH:mm" for an ISO timestamp (local time). */
export function timeOfDay(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}

/** "09:00" → seconds from midnight. Returns null for null input. */
export function parseTimeOfDay(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 3600 + m * 60;
}

/** Day label for history groups: Today / Yesterday / Mon 25 Aug. */
export function friendlyDayLabel(key: string): string {
  const d = parseDayKey(key);
  const today = todayKey();
  const yesterday = dateKeyOf(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return format(d, 'EEE d MMM');
}

/** "+13m" / "−7m" delta between actual and planned. */
export function deltaLabel(actualSeconds: number, expectedMinutes: number): string {
  const deltaSec = actualSeconds - expectedMinutes * 60;
  const sign = deltaSec >= 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(deltaSec))}`;
}
