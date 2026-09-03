'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { CalendarDays, CalendarRange, ChartNoAxesColumn, LayoutGrid, NotebookPen, Plus, Settings2, Sparkles, X } from 'lucide-react';
import { useAppStore } from '@/store/use-app-store';
import { useMounted, useTicker } from '@/hooks/use-ticker';
import { useTaskReminders } from '@/hooks/use-task-reminders';
import { cn } from '@/lib/utils';
import type { TabId } from '@/types';
import { ActiveTimerCard } from '@/components/active-timer-card';
import { TodayView } from '@/components/today-view';
import { WeekView } from '@/components/week-view';
import { OverviewView } from '@/components/overview-view';
import { HistoryView } from '@/components/history-view';
import { SettingsView } from '@/components/settings-view';
import { RatingSheet } from '@/components/rating-sheet';
import { TaskFormSheet } from '@/components/task-form-sheet';
import { TaskActionsSheet } from '@/components/task-actions-sheet';
import { ManualTimeSheet } from '@/components/manual-time-sheet';
import { NoteTakerSheet } from '@/components/note-taker-sheet';

const TABS: Array<{ id: TabId; label: string; icon: typeof CalendarDays }> = [
  { id: 'today', label: 'Today', icon: CalendarDays },
  { id: 'week', label: 'Week', icon: CalendarRange },
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'history', label: 'Insights', icon: ChartNoAxesColumn },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

export function AppShell() {
  const mounted = useMounted();
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const taskFormOpen = useAppStore((s) => s.taskFormOpen);
  const taskActionsOpen = useAppStore((s) => s.taskActionsOpen);
  const manualTimeOpen = useAppStore((s) => s.manualTimeOpen);
  const noteTakerOpen = useAppStore((s) => s.noteTakerOpen);
  const openTaskForm = useAppStore((s) => s.openTaskForm);
  const openNoteTaker = useAppStore((s) => s.openNoteTaker);
  const isFirstRun = useAppStore((s) => s.isFirstRun);
  const dismissFirstRun = useAppStore((s) => s.dismissFirstRun);

  // §4.4 recovery + first-run seed, after persisted state is available.
  useEffect(() => {
    if (!mounted) return;
    useAppStore.getState().ensureSeeded();
    useAppStore.getState().reconcile();

    // PWA: register the offline-shell service worker in production only,
    // so hot reload in dev is never served stale from cache.
    //
    // Update flow: sw.js skipWaiting()s a downloaded update, which fires
    // controllerchange here → one reload onto the new version. The guard
    // flag keeps it to a single reload (no loops on repeated events).
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          let reloading = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            // Only reload when an update took over (not on first install,
            // where no controller existed yet).
            if (navigator.serviceWorker.controller && !reloading) {
              reloading = true;
              window.location.reload();
            }
          });

          // Look for a new deploy when the user returns to the app and
          // once an hour, so updates surface without a store reinstall.
          const check = () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
          };
          document.addEventListener('visibilitychange', check);
          const hourly = window.setInterval(check, 60 * 60 * 1000);
          window.addEventListener('pagehide', () => {
            document.removeEventListener('visibilitychange', check);
            window.clearInterval(hourly);
          });
        })
        .catch(() => {});
    }
  }, [mounted]);

  // Keep the live timer honest across visibility changes (§4.4).
  useTicker(!!activeTimer);

  // 10-minute heads-up before each scheduled task (notification-permission gated).
  useTaskReminders();

  if (!mounted) {
    return (
      <div className="app-frame flex min-h-dvh items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-10 animate-pulse rounded-full border-[3px] border-primary border-t-transparent" />
          <p className="text-sm">Loading your plan…</p>
        </div>
      </div>
    );
  }

  const fabHidden = !!activeTimer || taskFormOpen || taskActionsOpen || manualTimeOpen || noteTakerOpen;

  return (
    /* reducedMotion="user": framer-motion disables transform/layout
       animations for users whose OS asks for reduced motion (opacity
       still fades so state changes remain visible). CSS animations and
       transitions are handled by the global media rule in globals.css. */
    <MotionConfig reducedMotion="user">
      <div className="app-frame relative min-h-dvh bg-background" data-testid="app-shell">
      <AnimatePresence>
        {isFirstRun && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="relative z-40"
            data-testid="first-run-banner"
          >
            <div className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <p className="flex-1 text-foreground/90">
                Loaded a demo plan with two weeks of history so you can explore.
                Reset anytime in <span className="font-medium">Settings</span> to start fresh.
              </p>
              <button
                onClick={dismissFirstRun}
                aria-label="Dismiss"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pb-44">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            /* On the wide (md+) frame the Week dashboard fills the canvas;
               every other view keeps its centered phone column. */
            className={activeTab === 'week' ? undefined : 'mx-auto w-full max-w-md'}
          >
            {activeTab === 'today' && <TodayView />}
            {activeTab === 'week' && <WeekView />}
            {activeTab === 'overview' && <OverviewView />}
            {activeTab === 'history' && <HistoryView />}
            {activeTab === 'settings' && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <ActiveTimerCard />

      {/* Structured-style FAB — hidden while a timer bar owns the space */}
      <AnimatePresence>
        {!fabHidden && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="pointer-events-none fixed inset-x-0 bottom-[calc(74px+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-md px-4 md:max-w-[64rem]"
            data-testid="fab-container"
          >
            <div className="flex items-end justify-end gap-3">
              {/* Secondary FAB — Note Taker (quick capture) */}
              <button
                onClick={() => openNoteTaker()}
                aria-label="Add note"
                data-testid="fab-add-note"
                className="pointer-events-auto grid size-12 place-items-center rounded-full border bg-card text-foreground shadow-lg shadow-black/10 transition-transform active:scale-95"
              >
                <NotebookPen className="size-5" aria-hidden />
              </button>
              <button
                onClick={() => openTaskForm()}
                aria-label="Add task"
                data-testid="fab-add-task"
                className="pointer-events-auto grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95"
              >
                <Plus className="size-6" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom tab bar — app chrome, respects iOS safe area */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-border/70 bg-background/85 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur-lg md:max-w-[64rem]"
        data-testid="bottom-nav"
      >
        {/* Phones: five tabs edge to edge; md+: centered group so the
            items don't stretch across the wide frame */}
        <div className="grid grid-cols-5 px-1 pt-1.5 md:mx-auto md:max-w-xl">
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={selected ? 'page' : undefined}
                data-testid={`tab-${id}`}
                className={cn(
                  'relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[10.5px] font-medium transition-colors',
                  selected ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-5" strokeWidth={selected ? 2.4 : 2} aria-hidden />
                {label}
                {selected && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-x-4 top-0 h-[3px] rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <RatingSheet />
      <TaskFormSheet />
      <TaskActionsSheet />
      <ManualTimeSheet />
      <NoteTakerSheet />
    </div>
    </MotionConfig>
  );
}
