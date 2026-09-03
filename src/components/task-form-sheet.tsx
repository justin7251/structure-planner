'use client';

import { useMemo, useRef, useState } from 'react';
import { CalendarDays, CopyX, Palette, Trash2, X } from 'lucide-react';
import {
  FullScreenModal,
  ModalContent,
  ModalDescription,
  ModalTitle,
} from '@/components/ui/full-screen-modal';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store/use-app-store';
import { toast } from 'sonner';
import { planDayLabel, todayKey, tomorrowKey } from '@/lib/format';
import { TASK_COLORS, TASK_COLOR_ORDER, TASK_ICONS, colorWithAlpha, iconMeta } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import type { Task, TaskColor } from '@/types';

const DURATION_CHIPS = [15, 30, 45, 60, 90, 120];

type DayChoice = 'today' | 'tomorrow' | 'pick' | 'any';

/** Classify a dateKey into the form's day-choice chips. */
function dayChoiceOf(key: string | null | undefined): DayChoice {
  if (key == null) return 'any';
  if (key === todayKey()) return 'today';
  if (key === tomorrowKey()) return 'tomorrow';
  return 'pick';
}

/**
 * Structured-style create/edit sheet: a full-width header tinted with the
 * task color (glyph + title live inside it), then scheduling and the
 * expected duration — the number every downstream estimate ratio is
 * measured against.
 *
 * Progressive disclosure: color and glyph pickers are hidden until asked
 * for — tap the banner background for colors, tap the glyph for icons —
 * so the form leads with what the task IS, not how it looks.
 */
export function TaskFormSheet() {
  const open = useAppStore((s) => s.taskFormOpen);
  const editingTaskId = useAppStore((s) => s.editingTaskId);
  const task = useAppStore((s) => (s.editingTaskId ? s.tasks[s.editingTaskId] : undefined));
  const datePrefill = useAppStore((s) => s.taskFormDatePrefill);
  const closeTaskForm = useAppStore((s) => s.closeTaskForm);

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && closeTaskForm()}>
      <ModalContent className="p-0" data-testid="task-form-sheet">
        {open && (
          <TaskFormFields
            key={editingTaskId ?? 'new'}
            task={task}
            prefillDateKey={datePrefill}
            onCancel={closeTaskForm}
          />
        )}
      </ModalContent>
    </FullScreenModal>
  );
}

function TaskFormFields(
  { task, onCancel, prefillDateKey }: { task?: Task; onCancel: () => void; prefillDateKey?: string | null },
) {
  const addTask = useAppStore((s) => s.addTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const prefill = useAppStore((s) => s.taskFormPrefill);
  const tasks = useAppStore((s) => s.tasks);

  const isEdit = !!task;
  const [title, setTitle] = useState(task?.title ?? '');
  const [detail, setDetail] = useState(task?.detail ?? '');
  const [category, setCategory] = useState(task?.category ?? '');
  const [color, setColor] = useState<TaskColor>(task?.color ?? 'coral');
  const [iconKey, setIconKey] = useState(task?.icon ?? 'alarm');
  const [minutes, setMinutes] = useState(String(task?.expectedDurationMinutes ?? 30));
  const [scheduled, setScheduled] = useState(isEdit ? !!task.scheduledStart : true);
  const [time, setTime] = useState(task?.scheduledStart ?? prefill ?? '09:00');
  // Day planning: which day this task belongs to. "any" = undated (legacy:
  // stays on Today's timeline every day), "pick" = a chosen calendar date.
  const initialDayKey = isEdit ? task.scheduledDateKey ?? null : prefillDateKey ?? todayKey();
  const [dayChoice, setDayChoice] = useState<DayChoice>(() => dayChoiceOf(initialDayKey));
  const [pickedDate, setPickedDate] = useState(() =>
    dayChoiceOf(initialDayKey) === 'pick' ? (initialDayKey ?? '') : ''
  );
  const [titleError, setTitleError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  /** Which on-demand picker is open — none by default, content comes first. */
  const [panel, setPanel] = useState<'none' | 'color' | 'icon'>('none');

  const togglePanel = (p: 'color' | 'icon') => setPanel((cur) => (cur === p ? 'none' : p));

  // Effective planned day for the current chip selection.
  const dayKey: string | null =
    dayChoice === 'today'
      ? todayKey()
      : dayChoice === 'tomorrow'
        ? tomorrowKey()
        : dayChoice === 'pick'
          ? pickedDate || null
          : null;
  const dayIsToday = dayKey === todayKey();

  const meta = TASK_COLORS[color];
  const ActiveIcon = iconMeta(iconKey).Icon;

  // Duplicate guard: a task with the same title that will share this day's
  // plan. Anytime tasks (no date) appear every day, so they clash with any
  // target day. Non-blocking — the user may genuinely want two blocks.
  const duplicateTitle = useMemo(() => {
    if (isEdit) return null;
    const norm = title.trim().toLowerCase();
    if (!norm) return null;
    const clash = Object.values(tasks).find(
      (t) =>
        !t.archived &&
        t.title.trim().toLowerCase() === norm &&
        (t.scheduledDateKey == null || t.scheduledDateKey === dayKey || dayKey == null),
    );
    return clash ? clash.title.trim() : null;
  }, [tasks, title, dayKey, isEdit]);

  // Re-entry guard: a double-tap on the save button must not create the
  // task twice (the sheet closes right after, but both taps land first).
  const submittingRef = useRef(false);

  const submit = () => {
    if (submittingRef.current) return;
    const trimmed = title.trim();
    const trimmedDetail = detail.trim();
    const mins = Math.round(Number(minutes));
    if (!trimmed) {
      setTitleError('Give the task a name');
      return;
    }
    if (!trimmedDetail) {
      setDetailError('Say exactly what this session involves');
      return;
    }
    if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) {
      toast.error('Expected duration must be between 1 and 1440 minutes');
      return;
    }
    const input = {
      title: trimmed,
      category: category.trim() ? category.trim() : null,
      detail: trimmedDetail,
      expectedDurationMinutes: mins,
      scheduledStart: scheduled ? time : null,
      scheduledDateKey: dayKey,
      color,
      icon: iconKey,
    };
    if (isEdit) {
      submittingRef.current = true;
      updateTask(task.id, input);
      toast.success('Task updated');
    } else {
      submittingRef.current = true;
      addTask(input);
      const when = dayKey && !dayIsToday ? `${planDayLabel(dayKey)}${scheduled ? ` ${time}` : ''}` : scheduled ? time : null;
      toast.success('Task planned', {
        description: `"${trimmed}" · ${when ? `${when} · ` : ''}${mins}m expected${
          dayKey && !dayIsToday ? ' — find it under Coming up' : ''
        }`,
      });
    }
    onCancel();
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <ModalTitle className="sr-only">{isEdit ? 'Edit task' : 'New task'}</ModalTitle>
      <ModalDescription className="sr-only">Task details</ModalDescription>

      {/* Colored header — tap the background for color options */}
      <div
        onClick={() => togglePanel('color')}
        className="relative shrink-0 cursor-pointer px-4 pb-3 pt-[max(env(safe-area-inset-top),0.5rem)] text-white transition-colors"
        style={{ backgroundColor: meta.hex }}
        data-testid="form-header"
      >
        <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-between">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            aria-label="Close"
            data-testid="form-close"
            className="grid size-8 place-items-center rounded-full bg-white/25 transition-colors hover:bg-white/35"
          >
            <X className="size-4" />
          </button>
          {scheduled && (
            <span className="rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-semibold tabular-nums">
              {dayKey && !dayIsToday ? `${planDayLabel(dayKey)} · ` : ''}
              {time} · {minutes}m
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-2.5">
          {/* Glyph trigger — tap to list icons */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePanel('icon');
            }}
            aria-label="Change icon"
            aria-expanded={panel === 'icon'}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/25 transition-colors hover:bg-white/35"
            data-testid="icon-trigger"
          >
            <ActiveIcon className="size-5" aria-hidden />
          </button>
          <input
            value={title}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="What will you work on?"
            autoFocus={!isEdit}
            aria-invalid={!!titleError}
            aria-label="Task title"
            className="w-full bg-transparent text-base font-bold text-white placeholder-white/60 outline-none"
            data-testid="task-title-input"
          />
        </div>
        {titleError && <p className="mt-1.5 text-xs font-medium text-white/90">{titleError}</p>}
        {/* Subtle affordance — shown only while both pickers are closed */}
        {panel === 'none' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePanel('color');
            }}
            className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-white/70 transition-colors hover:text-white"
            data-testid="style-hint"
          >
            <Palette className="size-3" aria-hidden />
            Tap the banner to change color · the icon to change glyph
          </button>
        )}
        </div>
      </div>

      <div className="mx-auto min-h-0 w-full max-w-md flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-3 pt-3.5">
        {/* Color — appears only when the banner is tapped */}
        {panel === 'color' && (
          <div data-testid="color-panel">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Color</Label>
              <button
                onClick={() => setPanel('none')}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                data-testid="color-panel-done"
              >
                Done
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2.5" data-testid="color-picker">
              {TASK_COLOR_ORDER.map((key) => (
                <button
                  key={key}
                  onClick={() => setColor(key)}
                  aria-label={TASK_COLORS[key].label}
                  aria-pressed={color === key}
                  className={cn(
                    'size-8 rounded-full transition-transform',
                    color === key ? 'scale-110 ring-2 ring-foreground/70 ring-offset-2 ring-offset-background' : 'active:scale-95'
                  )}
                  style={{ backgroundColor: TASK_COLORS[key].hex }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Icon — appears only when the glyph is tapped */}
        {panel === 'icon' && (
          <div data-testid="icon-panel">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Icon</Label>
              <button
                onClick={() => setPanel('none')}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                data-testid="icon-panel-done"
              >
                Done
              </button>
            </div>
            <div className="mt-2 grid max-h-[168px] grid-cols-6 gap-2 overflow-y-auto pr-1" data-testid="icon-picker">
              {TASK_ICONS.map(({ key, Icon, label }) => {
                const selected = key === iconKey;
                return (
                  <button
                    key={key}
                    onClick={() => setIconKey(key)}
                    aria-label={label}
                    aria-pressed={selected}
                    className={cn(
                      'grid size-10 place-items-center rounded-full transition-colors',
                      selected ? 'text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    )}
                    style={selected ? { backgroundColor: meta.hex } : undefined}
                  >
                    <Icon className="size-4.5" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Specific detail — mandatory: it is what makes a timeline block
            self-explanatory later ("Math" alone says nothing). Grows with
            content — room for a couple of sentences without taking over
            the form; past that it scrolls. Enter wraps lines here; the
            pinned Save button submits. */}
        <div className="grid gap-1.5">
          <Label htmlFor="task-detail">Specific detail</Label>
          <Textarea
            id="task-detail"
            value={detail}
            onChange={(e) => {
              setDetail(e.target.value);
              setDetailError(null);
            }}
            rows={2}
            aria-invalid={!!detailError}
            data-testid="task-detail-input"
            className="max-h-[168px] min-h-[76px] resize-none overflow-y-auto"
            placeholder="What exactly does done look like?"
          />
          {detailError && <p className="text-xs font-medium text-destructive">{detailError}</p>}
        </div>

        {/* Scheduling — one grouped card; the time fields slide in when on */}
        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center justify-between px-3.5 py-3">
            <div>
              <Label htmlFor="task-scheduled" className="text-sm">Scheduled time</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">Place it on the day timeline</p>
            </div>
            <Switch
              id="task-scheduled"
              checked={scheduled}
              onCheckedChange={setScheduled}
              data-testid="task-scheduled-switch"
            />
          </div>

          {/* Day — which day the plan belongs to (timed and anytime tasks both) */}
          <div className="border-t px-3.5 py-3">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Day
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="day-chips">
              {([
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                {
                  id: 'pick',
                  label:
                    dayChoice === 'pick' && pickedDate ? planDayLabel(pickedDate) : 'Pick a date…',
                },
                { id: 'any', label: 'Any day' },
              ] as Array<{ id: DayChoice; label: string }>).map(({ id, label }) => {
                const selected = dayChoice === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setDayChoice(id);
                      if (id === 'pick' && !pickedDate) setPickedDate(tomorrowKey());
                    }}
                    aria-pressed={selected}
                    title={
                      id === 'any'
                        ? 'No fixed day — stays on Today\u2019s timeline until done'
                        : undefined
                    }
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      selected ? 'text-white' : 'border-border text-muted-foreground hover:bg-muted/60'
                    )}
                    style={selected ? { backgroundColor: meta.hex, borderColor: meta.hex } : undefined}
                    data-testid={`day-chip-${id}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {dayChoice === 'pick' && (
              <Input
                type="date"
                value={pickedDate}
                onChange={(e) => setPickedDate(e.target.value || tomorrowKey())}
                className="mt-2"
                aria-label="Pick a date"
                data-testid="day-date-input"
              />
            )}
          </div>
          <div
            aria-hidden={!scheduled}
            inert={!scheduled}
            className={cn(
              'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(.32,.72,0,1)]',
              scheduled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div className="overflow-hidden">
              <div className="border-t px-3.5 py-3">
                {scheduled ? (
                  /* min-w-0 lets the inputs shrink instead of overflowing their
                     track — on phones the raw intrinsic input width made
                     "Expected (min)" print on top of "Starts at". Below 420px
                     the two fields stack for comfortable touch targets. */
                  <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="task-time">Starts at</Label>
                      <Input
                        id="task-time"
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        data-testid="task-time-input"
                      />
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="task-minutes">Expected (min)</Label>
                      <Input
                        id="task-minutes"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={1440}
                        value={minutes}
                        onChange={(e) => setMinutes(e.target.value)}
                        data-testid="task-minutes-input"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <Label htmlFor="task-minutes-anytime">Expected duration (minutes)</Label>
                    <Input
                      id="task-minutes-anytime"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1440}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      data-testid="task-minutes-input"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick durations */}
        <div className="flex flex-wrap gap-2">
          {DURATION_CHIPS.map((m) => (
            <button
              key={m}
              onClick={() => setMinutes(String(m))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                Number(minutes) === m ? 'text-white' : 'border-border text-muted-foreground hover:bg-muted/60'
              )}
              style={Number(minutes) === m ? { backgroundColor: meta.hex, borderColor: meta.hex } : undefined}
            >
              {m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`}
            </button>
          ))}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="task-category">List / category (optional)</Label>
          <Input
            id="task-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Focus, Admin…"
          />
        </div>
      </div>

      {/* Pinned footer — Continue is always reachable without scrolling */}
      <div className="shrink-0 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="mx-auto w-full max-w-md">
          {duplicateTitle && (
            <div
              data-testid="form-duplicate-warning"
              className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] leading-snug text-amber-700 dark:text-amber-400"
            >
              <CopyX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                “{duplicateTitle}” already exists on this day's plan — saving will create a second
                copy.
              </span>
            </div>
          )}
          <div className="flex gap-2">
          {isEdit && (
            <button
              onClick={() => {
                deleteTask(task.id);
                toast.success('Task deleted');
                onCancel();
              }}
              className="grid size-12 shrink-0 place-items-center rounded-xl border border-destructive/30 text-destructive transition-colors hover:bg-destructive/10"
              aria-label="Delete task"
              data-testid="task-delete"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
          <button
            onClick={submit}
            className="h-12 w-full rounded-xl text-[15px] font-bold text-white transition-transform active:scale-[0.99]"
            style={{ backgroundColor: meta.hex, boxShadow: `0 6px 18px ${colorWithAlpha(meta.hex, '40')}` }}
            data-testid="task-submit"
          >
            {isEdit ? 'Save changes' : 'Continue'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
