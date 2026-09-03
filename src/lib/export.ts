import type { Log, Note, Task } from '@/types';

/**
 * User-facing data export — a JSON backup (re-importable shape, mirrors the
 * Firestore doc structure) and a CSV of sessions (spreadsheet-friendly).
 * Pure string builders: the caller owns filenames, download, and toasts.
 */

const EXPORT_VERSION = 1;

export interface ExportPayload {
  tasks: Task[];
  logs: Log[];
  notes: Note[];
}

export function buildExportJson({ tasks, logs, notes }: ExportPayload): string {
  return JSON.stringify(
    {
      app: 'structure-planner',
      exportVersion: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      tasks,
      logs,
      notes,
    },
    null,
    2
  );
}

const CSV_COLUMNS = [
  'date',
  'started_at',
  'completed_at',
  'task',
  'task_id',
  'status',
  'expected_min',
  'actual_min',
  'rating',
  'entry_mode',
] as const;

function csvField(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  // Quote when the field contains anything the CSV grammar cares about.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildExportCsv(logs: Log[]): string {
  const rows = [...logs].sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || (a.startedAt ?? '').localeCompare(b.startedAt ?? '')
  );
  const lines = [CSV_COLUMNS.join(',')];
  for (const l of rows) {
    lines.push(
      [
        l.dateKey,
        l.startedAt ?? '',
        l.completedAt ?? '',
        l.taskTitle,
        l.taskId,
        l.status,
        l.expectedMinutes,
        l.actualDurationSeconds != null ? Math.round(l.actualDurationSeconds / 60) : '',
        l.rating ?? '',
        l.entryMode,
      ]
        .map(csvField)
        .join(',')
    );
  }
  return lines.join('\r\n');
}

/** Trigger a client-side download of a text payload (no network involved). */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before reclaiming the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
