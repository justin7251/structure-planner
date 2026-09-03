'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { toast } from 'sonner';
import { useAppStore } from '@/store/use-app-store';
import { useTicker } from '@/hooks/use-ticker';
import { formatDuration, parseTimeOfDay, todayKey } from '@/lib/format';
import { latestLogByTask } from '@/lib/logs';
import { ratioFor } from '@/lib/rating/suggestRating';
import { haptics } from '@/lib/haptics';
import { colorWithAlpha, iconMeta, taskColorMeta, taskTextClass } from '@/lib/task-style';
import { cn } from '@/lib/utils';
import type { Log, Task } from '@/types';

/**
 * Structured-style day timeline: an hour-ruled day grid where every
 * scheduled task is a real colored block spanning its planned duration
 * (§3 schema drives the geometry: scheduledStart → top, expectedMinutes
 * → height). Blocks can be rescheduled and resized — both snap to
 * 5 minutes, so the plan stays honest. The running task becomes a tall
 * colored pill on the axis plus a progress-filled block, and a coral
 * now-line tracks the minute.
 *
 * Touch vs. mouse: dragging on touch requires a ~280ms long-press (with
 * haptic + lift) — a finger that moves before that is a SCROLL, so the
 * page never fights the gesture (old behavior: any touch moved the task).
 * Mouse keeps instant press-and-drag. Tapping a block always opens its
 * action sheet; tapping an empty hour prefills the create sheet.
 */

const PX_PER_HOUR = 76; // vertical scale — 30m ≈ 38px so short blocks stay legible
const GUTTER = 48; // px — left axis with hour labels
const SNAP_MIN = 5;
const TAP_SLOP_PX = 6;
/** Hold-still time before a touch becomes a drag (mouse drags instantly). */
const LONG_PRESS_MS = 280;
/** Visual breathing room: consecutive blocks would otherwise touch and
 *  read as one merged blob (user feedback: "tasks look too close"). */
const BLOCK_GAP = 2; // px inset top and bottom

interface Positioned {
  task: Task;
  top: number; // px from day start
  height: number; // px of planned block
  lane: number;
  /** Highest lane index among tasks overlapping this one (incl. itself). */
  clusterMax: number;
}

const fmtSec = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

export function Timeline() {
  const tasksRecord = useAppStore((s) => s.tasks);
  const logsRecord = useAppStore((s) => s.logs);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const openTaskForm = useAppStore((s) => s.openTaskForm);
  const openTaskActions = useAppStore((s) => s.openTaskActions);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Cosmetic tick only — elapsed is always recomputed from timestamps (§4.1).
  const tick = useTicker(true);

  // Today's grid only: undated tasks (legacy "any day") plus tasks planned
  // for today. Dated future tasks live under Today → "Coming up" and on
  // their day in Overview — they must not occupy today's hour blocks.
  const tasks = useMemo(
    () =>
      Object.values(tasksRecord).filter(
        (t) => !t.archived && t.scheduledStart && (!t.scheduledDateKey || t.scheduledDateKey === todayKey())
      ),
    [tasksRecord]
  );

  // Latest session per task, TODAY (local day key — never a UTC-derived
  // key, which disagrees with log.dateKey for hours around midnight).
  // Re-computed on the cosmetic tick so the map rolls over at midnight.
  const latestLogMap = useMemo(
    () => latestLogByTask(logsRecord, todayKey()),
    [logsRecord, tick]
  );

  const positioned = useMemo(() => {
    const sorted = [...tasks].sort(
      (a, b) => (parseTimeOfDay(a.scheduledStart) ?? 0) - (parseTimeOfDay(b.scheduledStart) ?? 0)
    );
    const out: Positioned[] = [];
    // Greedy lanes: a task whose block overlaps a previous one sits beside it.
    const laneEnds: number[] = [];
    for (const task of sorted) {
      const startSec = parseTimeOfDay(task.scheduledStart) ?? 0;
      const top = (startSec / 3600) * PX_PER_HOUR;
      const height = Math.max(30, (task.expectedDurationMinutes / 60) * PX_PER_HOUR);
      let lane = laneEnds.findIndex((end) => end <= top + 8);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(top + height);
      } else {
        laneEnds[lane] = top + height;
      }
      out.push({ task, top, height, lane: Math.min(lane, 2), clusterMax: 0 });
    }
    // Resolve overlap clusters so side-by-side blocks split the width
    // instead of printing on top of each other.
    for (const p of out) {
      let max = p.lane;
      for (const q of out) {
        if (q === p) continue;
        if (q.top < p.top + p.height && q.top + q.height > p.top) max = Math.max(max, q.lane);
      }
      p.clusterMax = max;
    }
    return out;
  }, [tasks]);

  const commitMove = (taskId: string, prevStart: string | null, newStartSec: number) => {
    const hhmm = fmtSec(newStartSec);
    useAppStore.getState().updateTask(taskId, { scheduledStart: hhmm });
    haptics.light();
    toast(`Moved to ${hhmm}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => useAppStore.getState().updateTask(taskId, { scheduledStart: prevStart }),
      },
    });
  };

  const commitResize = (taskId: string, prevMinutes: number, newMinutes: number) => {
    useAppStore.getState().updateTask(taskId, { expectedDurationMinutes: newMinutes });
    haptics.light();
    toast(`Now ${formatDuration(newMinutes * 60)} planned`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () =>
          useAppStore.getState().updateTask(taskId, { expectedDurationMinutes: prevMinutes }),
      },
    });
  };

  // Running task must exist among scheduled tasks for the pill; if it is an
  // unscheduled task, the ActiveTimerCard still shows it globally.
  const runningTask = activeTimer ? tasksRecord[activeTimer.taskId] : undefined;
  const runningScheduled = runningTask?.scheduledStart ? runningTask : undefined;
  const nowSec = new Date().getHours() * 3600 + new Date().getMinutes() * 60;
  const nowTop = (nowSec / 3600) * PX_PER_HOUR;

  // Auto-scroll so "now" (or the first task) sits near the top of the
  // viewport — mirrors Structured opening on the current moment.
  useEffect(() => {
    const firstTaskTop = positioned[0]?.top ?? nowTop;
    const target = Math.min(nowTop, firstTaskTop);
    const el = wrapperRef.current;
    if (!el) return;
    const absoluteTop = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, absoluteTop + target - 150), behavior: 'instant' as ScrollBehavior });
    // Run once on mount only.
  }, []);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const nowLabel = fmtDate(new Date(), 'HH:mm');
  return (
    <div ref={wrapperRef} className="relative select-none" data-testid="timeline" data-tick={tick}>
      <div className="relative" style={{ height: 24 * PX_PER_HOUR + 40 }}>
        {/* Hour gridlines + labels */}
        {hours.map((h) => (
          <div key={h} className="absolute inset-x-0" style={{ top: (h / 24) * (24 * PX_PER_HOUR) + 20 }}>
            <span className="absolute left-0 w-12 pr-2 text-right text-[10px] font-medium tabular-nums text-muted-foreground/70" style={{ top: -6 }}>
              {String(h).padStart(2, '0')}:00
            </span>
            <div className="ml-12 border-t border-border/60" />
          </div>
        ))}

        {/* Empty-hour tap targets — create a task prefilled at that hour */}
        {hours.map((h) => (
          <button
            key={`slot-${h}`}
            aria-label={`Add task at ${String(h).padStart(2, '0')}:00`}
            onClick={() => openTaskForm(undefined, `${String(h).padStart(2, '0')}:00`)}
            className="absolute left-0 right-0 z-[1] cursor-pointer"
            style={{ top: (h / 24) * (24 * PX_PER_HOUR) + 20, height: PX_PER_HOUR }}
          />
        ))}

        {/* Draggable, resizable task blocks */}
        {positioned.map(({ task, top, height, lane, clusterMax }) => (
          <DraggableTaskBlock
            key={task.id}
            task={task}
            top={top + 20}
            height={height}
            lane={lane}
            clusterMax={clusterMax}
            latestLog={latestLogMap.get(task.id)}
            isRunning={activeTimer?.taskId === task.id}
            runningStartedAt={activeTimer?.taskId === task.id ? activeTimer.startedAt : null}
            onOpen={() => openTaskActions(task.id)}
            onCommitMove={(sec) => commitMove(task.id, task.scheduledStart, sec)}
            onCommitResize={(min) => commitResize(task.id, task.expectedDurationMinutes, min)}
          />
        ))}

        {/* Running pill — Structured's tall colored capsule on the axis */}
        {runningScheduled && activeTimer && (
          <RunningPill
            top={(parseTimeOfDay(runningScheduled.scheduledStart)! / 3600) * PX_PER_HOUR + 20}
            plannedHeight={Math.max(36, (runningScheduled.expectedDurationMinutes / 60) * PX_PER_HOUR)}
            startedAt={activeTimer.startedAt}
            plannedMinutes={runningScheduled.expectedDurationMinutes}
            color={runningScheduled.color}
            iconKey={runningScheduled.icon}
          />
        )}

        {/* Now line */}
        <div className="pointer-events-none absolute inset-x-0 z-[30]" style={{ top: nowTop + 20 }} data-testid="now-line">
          <span className="absolute left-0 grid w-12 place-items-center pr-1">
            <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-bold tabular-nums text-primary-foreground shadow-sm">
              {nowLabel}
            </span>
          </span>
          <div className="ml-12 border-t-2 border-primary/80" style={{ marginRight: 8 }}>
            <span className="absolute -top-[4px] left-[44px] size-2 rounded-full bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

type DragMode = 'move' | 'resize';

interface DragState {
  mode: DragMode;
  startY: number;
  deltaY: number;
  moved: boolean;
  /** Drag is really running — for touch only after the long-press. */
  active: boolean;
  pointerId: number;
  isMouse: boolean;
  /** Long-press activation timer (touch only). */
  timer: ReturnType<typeof setTimeout> | null;
}

function DraggableTaskBlock({
  task,
  top,
  height,
  lane,
  clusterMax,
  latestLog,
  isRunning,
  runningStartedAt,
  onOpen,
  onCommitMove,
  onCommitResize,
}: {
  task: Task;
  top: number;
  height: number;
  lane: number;
  clusterMax: number;
  latestLog: Log | undefined;
  isRunning: boolean;
  runningStartedAt: number | null;
  onOpen: () => void;
  onCommitMove: (newStartSec: number) => void;
  onCommitResize: (newMinutes: number) => void;
}) {
  const meta = taskColorMeta(task.color);
  const { Icon } = iconMeta(task.icon);
  const startSec = parseTimeOfDay(task.scheduledStart) ?? 0;
  const endSec = startSec + task.expectedDurationMinutes * 60;

  const dragRef = useRef<DragState | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragging = !!drag && drag.moved;
  const dragActive = !!drag && drag.active;

  // While a touch drag is live, own the gesture: without this the page
  // starts scrolling mid-drag (touch-action pan-y lets the browser pan
  // otherwise, which is exactly what we want when NOT dragging).
  useEffect(() => {
    if (!dragActive) return;
    const el = blockRef.current;
    if (!el) return;
    const stopScroll = (ev: TouchEvent) => ev.preventDefault();
    el.addEventListener('touchmove', stopScroll, { passive: false });
    return () => el.removeEventListener('touchmove', stopScroll);
  }, [dragActive]);

  // Done is done — rating is reflection, not completion (matches timeline-row).
  const completedToday = latestLog?.status === 'completed';
  const notDone = latestLog?.status === 'abandoned' && latestLog.startedAt == null;
  const runningElsewhere = !isRunning && latestLog?.status === 'running';

  const compact = lane > 0;
  const durMin = task.expectedDurationMinutes;
  // Tall enough for the time range on its own line (≈45m+ blocks).
  const showMeta = height >= 46 && !compact;

  // Live remaining/over while running (display only — §4.1).
  let liveSubtitle: string | null = null;
  let elapsedFrac: number | null = null;
  if (isRunning && runningStartedAt) {
    const elapsed = (Date.now() - runningStartedAt) / 1000;
    const remaining = durMin * 60 - elapsed;
    liveSubtitle =
      remaining >= 0 ? `${formatDuration(remaining)} remaining` : `${formatDuration(-remaining)} over plan`;
    elapsedFrac = Math.min(1, elapsed / (durMin * 60));
  }

  // What the block can show without clipping (content lines ≈ 14/17/15px
  // + 16px padding). Detail is mandatory now, so use it to make blocks
  // self-explanatory: short blocks append it inline after the title,
  // tall blocks get their own line — unless a status line takes over
  // once the session is running/done (reflection beats description).
  const hasStatusLine = !!liveSubtitle || notDone || completedToday;
  const showDetailLine = !compact && !!task.detail && height >= 64 && !hasStatusLine;
  const showInlineDetail = !compact && !!task.detail && !hasStatusLine && !showDetailLine;

  // Drag previews (snapped, so the chip shows exactly what will commit).
  const previewStartSec =
    drag?.moved && drag.mode === 'move'
      ? Math.min(
          Math.max(0, Math.round((startSec / 60 + (drag.deltaY / PX_PER_HOUR) * 60) / SNAP_MIN) * SNAP_MIN * 60),
          24 * 3600 - durMin * 60
        )
      : startSec;
  const previewMinutes =
    drag?.moved && drag.mode === 'resize'
      ? Math.min(
          12 * 60,
          Math.max(SNAP_MIN, Math.round((((height + drag.deltaY) / PX_PER_HOUR) * 60) / SNAP_MIN) * SNAP_MIN)
        )
      : durMin;

  const capture = (pointerId: number) => {
    try {
      blockRef.current?.setPointerCapture?.(pointerId);
    } catch {
      // pointer already gone (e.g. long-press fired after release) — drag just won't run
    }
  };

  const activateDrag = (state: DragState) => {
    state.active = true;
    state.moved = true; // lifted = committed intent; release w/o move is a no-op
    haptics.light();
    capture(state.pointerId);
    setDrag({ ...state });
  };

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const isMouse = e.pointerType === 'mouse';
    const state: DragState = {
      mode,
      startY: e.clientY,
      deltaY: 0,
      moved: false,
      active: isMouse,
      pointerId: e.pointerId,
      isMouse,
      timer: null,
    };
    dragRef.current = state;
    if (isMouse) {
      capture(e.pointerId);
      haptics.light();
    } else {
      // Touch: hold still for a beat to lift the block. A finger that
      // moves first is a scroll — moveDrag cancels the timer and the
      // browser keeps the gesture (the block never hijacks scrolling).
      state.timer = setTimeout(() => {
        const s = dragRef.current;
        if (!s || s.pointerId !== state.pointerId) return;
        activateDrag(s);
      }, LONG_PRESS_MS);
    }
  };

  const moveDrag = (e: React.PointerEvent) => {
    const state = dragRef.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dy = e.clientY - state.startY;
    if (!state.active) {
      if (Math.abs(dy) > TAP_SLOP_PX) {
        // Moved before the long-press → this is a scroll. Stand down.
        if (state.timer) clearTimeout(state.timer);
        dragRef.current = null;
      }
      return;
    }
    state.deltaY = dy;
    state.moved = state.moved || Math.abs(dy) > TAP_SLOP_PX || !state.isMouse;
    setDrag({ ...state });
  };

  const endDrag = (e: React.PointerEvent) => {
    const state = dragRef.current;
    dragRef.current = null;
    if (state?.timer) clearTimeout(state.timer);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // capture already released with the pointer
    }
    if (!state) return;
    suppressClick.current = state.moved;
    if (state.moved) {
      // A lift without real movement (long-press released in place, or a
      // drag that returned to the exact original slot/size) is a no-op —
      // never commit a fake move/resize (and never toast about it).
      if (state.mode === 'move') {
        if (previewStartSec !== startSec) onCommitMove(previewStartSec);
      } else if (previewMinutes !== durMin) {
        onCommitResize(previewMinutes);
      }
    }
    setDrag(null);
  };

  return (
    <motion.div
      ref={blockRef}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: dragging ? 1.02 : 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      role="button"
      tabIndex={0}
      title="Tap for actions · hold to drag"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onOpen();
      }}
      onPointerDown={beginDrag('move')}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        // pan-y: vertical page scroll starting on a block stays native;
        // only an activated drag (long-press on touch) takes over.
        'absolute flex [touch-action:pan-y] items-start overflow-hidden text-left transition-shadow',
        compact ? 'min-h-[38px] gap-1.5 rounded-xl px-1.5 py-1' : 'gap-2 rounded-2xl p-2 pr-2.5',
        dragging ? 'z-50 cursor-grabbing shadow-xl shadow-black/20' : 'z-10 cursor-grab',
        compact && dragging && 'ring-1 ring-foreground/10'
      )}
      style={{
        top: dragging && drag.mode === 'move' ? top + drag.deltaY : top + BLOCK_GAP,
        height:
          dragging && drag.mode === 'resize'
            ? Math.max(26, height + drag.deltaY)
            : Math.max(24, height - BLOCK_GAP * 2),
        left: compact ? '56%' : GUTTER - 8,
        right: compact ? 6 : clusterMax > lane ? `${(clusterMax - lane) * 46 + 4}%` : 8,
        backgroundColor: dragging ? colorWithAlpha(meta.hex, '33') : colorWithAlpha(meta.hex, '26'),
        border: `1.5px solid ${colorWithAlpha(meta.hex, dragging ? 'b3' : '59')}`,
        boxShadow: dragging ? `0 8px 24px ${colorWithAlpha(meta.hex, '55')}` : undefined,
      }}
      data-testid={`timeline-task-${task.id}`}
      data-dragging={dragging || undefined}
      aria-label={`${task.title}, ${fmtSec(startSec)} to ${fmtSec(endSec)}`}
    >
      {/* Running progress fill */}
      {isRunning && elapsedFrac != null && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-white/20"
          style={{ width: `${elapsedFrac * 100}%` }}
          aria-hidden
        />
      )}

      {!isRunning && (
        <span
          className={cn(
            'z-10 grid shrink-0 place-items-center self-start rounded-full text-white shadow-sm',
            compact ? 'size-6' : 'size-7'
          )}
          style={{ backgroundColor: meta.hex }}
        >
          <Icon className={compact ? 'size-3' : 'size-3.5'} aria-hidden />
        </span>
      )}

      <span className={cn('relative z-10 min-w-0 flex-1', isRunning && 'ml-1')}>
        {showMeta && (
          <span className="block truncate text-[10.5px] font-semibold tabular-nums opacity-80" style={{ color: 'inherit' }}>
            {fmtSec(previewStartSec)} - {fmtSec(previewStartSec + previewMinutes * 60)}
          </span>
        )}
        <span
          className={cn(
            'block truncate font-bold leading-tight',
            compact ? 'text-[12.5px]' : 'text-[14px]',
            taskTextClass(task.color)
          )}
        >
          {task.title}
          {showInlineDetail && (
            <span className="font-medium opacity-60" data-testid={`block-detail-${task.id}`}>
              {' · '}
              {task.detail}
            </span>
          )}
        </span>
        {showDetailLine && (
          <span
            className="mt-0.5 block truncate text-[11px] font-medium opacity-75"
            data-testid={`block-detail-${task.id}`}
          >
            {task.detail}
          </span>
        )}
        {compact ? null : height >= 48 ? (
          liveSubtitle ? (
          <span
            className="mt-0.5 block text-[11px] font-bold tabular-nums text-primary"
            data-testid="live-remaining"
          >
            {liveSubtitle}
          </span>
        ) : notDone ? (
          <span className="mt-0.5 block text-[11px] font-bold text-destructive">Marked not done</span>
        ) : completedToday && latestLog?.actualDurationSeconds != null ? (
          <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground tabular-nums">
            {formatDuration(latestLog.actualDurationSeconds)} actual
            {ratioFor(latestLog.actualDurationSeconds, latestLog.expectedMinutes) != null &&
              ` · ${ratioFor(latestLog.actualDurationSeconds, latestLog.expectedMinutes)!.toFixed(2)}×`}
          </span>
        ) : completedToday ? (
          <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">Done · untimed</span>
        ) : null
        ) : null}
      </span>

      {/* Status circle */}
      <span className="relative z-10 shrink-0 self-start pt-0.5">
        {completedToday ? (
          <span
            className="grid size-5.5 place-items-center rounded-full text-white"
            style={{ backgroundColor: meta.hex }}
            aria-label="Completed"
          >
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
        ) : isRunning ? (
          <span className="relative grid size-5.5 place-items-center" aria-label="Running">
            <span className="absolute size-5.5 animate-ping rounded-full bg-primary/30" aria-hidden />
            <span className="size-2.5 rounded-full bg-primary" />
          </span>
        ) : (
          <span
            className={cn('size-5.5 rounded-full border-2 bg-background/40', runningElsewhere ? 'border-border/50' : 'border-border')}
            aria-hidden
          />
        )}
      </span>

      {/* Resize handle — hold, then drag the bottom edge to change planned duration */}
      <span
        role="separator"
        aria-label={`Resize ${task.title}`}
        data-handle="resize"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginDrag('resize')(e);
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute inset-x-0 bottom-0 z-20 flex h-6 [touch-action:pan-y] cursor-ns-resize items-end justify-center pb-0.5"
      >
        <span
          className={cn(
            'h-1 w-10 rounded-full transition-opacity',
            dragging && drag?.mode === 'resize' ? 'opacity-100' : 'opacity-40'
          )}
          style={{ backgroundColor: colorWithAlpha(meta.hex, 'cc') }}
          aria-hidden
        />
      </span>

      {/* Snap chip while dragging */}
      {dragging && (
        <span
          className="pointer-events-none absolute -top-7 left-2 z-50 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums text-white shadow-md"
          style={{ backgroundColor: meta.hex }}
          data-testid="drag-chip"
        >
          {drag.mode === 'move'
            ? `${fmtSec(previewStartSec)} – ${fmtSec(previewStartSec + previewMinutes * 60)}`
            : `${previewMinutes} min`}
        </span>
      )}
    </motion.div>
  );
}

function RunningPill({
  top,
  plannedHeight,
  startedAt,
  plannedMinutes,
  color,
  iconKey,
}: {
  top: number;
  plannedHeight: number;
  startedAt: number;
  plannedMinutes: number;
  color: Task['color'];
  iconKey: string;
}) {
  const meta = taskColorMeta(color);
  const { Icon } = iconMeta(iconKey);
  const height = Math.min(200, Math.max(40, plannedHeight));
  const elapsedFrac = Math.min(1, (Date.now() - startedAt) / (plannedMinutes * 60_000));

  return (
    <motion.div
      initial={{ scaleY: 0.6, opacity: 0 }}
      animate={{ scaleY: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="pointer-events-none absolute z-20 flex w-9 items-start justify-center overflow-hidden rounded-full shadow-md"
      style={{ top, height, left: 6, backgroundColor: meta.hex, transformOrigin: 'top' }}
      data-testid="running-pill"
      aria-hidden
    >
      <div className="absolute inset-x-0 top-0 bg-white/25 transition-all" style={{ height: `${elapsedFrac * 100}%` }} />
      <Icon className="relative mt-2 size-4 text-white" aria-hidden />
    </motion.div>
  );
}
