'use client';

import { useEffect, useMemo, useState } from 'react';
import { format, isToday } from 'date-fns';
import { ArchiveRestore, ArrowLeft, Bell, Database, Download, ExternalLink, KeyRound, LogOut, Moon, RefreshCw, Sparkles, Sun, Trash2, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { selectArchivedTasks, useAppStore } from '@/store/use-app-store';
import { useAuthStore } from '@/store/use-auth-store';
import { signOutGoogleUser } from '@/lib/firebase/auth';
import { notificationSupport } from '@/lib/notifications/web';
import { notifications } from '@/lib/notifications';
import { useMounted } from '@/hooks/use-ticker';
import { useSyncNow } from '@/hooks/use-sync';
import { ExitToLandingButton } from '@/components/exit-to-landing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatDuration, dateKeyOf } from '@/lib/format';
import {
  DAILY_REVIEW_CAP,
  clearApiKey,
  describeApiKey,
  getApiKey,
  getUsageToday,
  setApiKey,
} from '@/lib/ai/review-client';
import { buildExportCsv, buildExportJson, downloadTextFile } from '@/lib/export';
import { cn } from '@/lib/utils';

export function SettingsView() {
  return (
    <div className="px-4 pt-5" data-testid="settings-view">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tune</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">Settings</h1>
        </div>
        <ExitToLandingButton variant="pill" testid="settings-exit" />
      </header>
      <ProfileCard />
      <SyncCard />
      <ThresholdCard />
      <NotificationsCard />
      <AiCard />
      <AppearanceCard />
      <ArchivedCard />
      <DataCard />
      <AboutCard />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
  testid,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <section className="mb-4 rounded-2xl border bg-card p-4" data-testid={testid}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProfileCard() {
  const displayName = useAppStore((s) => s.profile.displayName);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const authUser = useAuthStore((s) => s.user);
  const [name, setName] = useState(displayName);
  const [syncedName, setSyncedName] = useState(displayName);
  const [signingOut, setSigningOut] = useState(false);

  // React's "adjust state during render" pattern: resync the input when
  // the store's displayName changes externally (e.g. reset/load demo).
  if (syncedName !== displayName) {
    setSyncedName(displayName);
    setName(displayName);
  }

  return (
    <Section icon={UserRound} title="Profile">
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/12 font-bold text-primary">
          {(displayName || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed && trimmed !== displayName) {
                updateProfile({ displayName: trimmed });
                toast.success('Name updated');
              } else {
                setName(displayName);
              }
            }}
            aria-label="Display name"
            data-testid="profile-name-input"
          />
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {authUser ? authUser.email ?? 'Signed in' : 'Local profile · stored on this device'}
          </p>
        </div>
        {authUser ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 rounded-lg text-xs text-muted-foreground hover:text-foreground"
            disabled={signingOut}
            data-testid="profile-signout"
            onClick={async () => {
              setSigningOut(true);
              try {
                await signOutGoogleUser();
                useAppStore.getState().exitToLanding();
                toast.success('Signed out');
              } catch {
                toast.error("Couldn't sign out. Please try again.");
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <LogOut className="size-3.5" aria-hidden />
            Sign out
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 rounded-lg text-xs text-muted-foreground hover:text-foreground"
            data-testid="profile-exit-landing"
            onClick={() => {
              useAppStore.getState().exitToLanding();
              toast('Back to the start page', {
                description: 'Your data stays on this device — tap "Try the live demo" there to return.',
                duration: 6000,
              });
            }}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to landing
          </Button>
        )}
      </div>
    </Section>
  );
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'not yet this session';
  const d = new Date(iso);
  return isToday(d) ? `today at ${format(d, 'HH:mm')}` : format(d, "d MMM, HH:mm");
}

/**
 * Cloud sync status + manual "Sync now" (signed-in users only). Phones
 * suspend background tabs and the live listeners don't always wake up —
 * this gives an explicit way to force a full push + pull cycle.
 */
function SyncCard() {
  const authUser = useAuthStore((s) => s.user);
  const lastSyncAt = useAuthStore((s) => s.lastSyncAt);
  const sync = useSyncNow();

  if (!authUser) return null;

  return (
    <Section icon={RefreshCw} title="Cloud sync" testid="sync-card">
      <p className="text-sm text-muted-foreground">
        Signed in as{' '}
        <span className="font-medium text-foreground">{authUser.email ?? 'Google account'}</span>.
        Changes upload automatically and edits made on your other devices arrive live.
      </p>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="last-sync">
        Last sync: {formatLastSync(lastSyncAt)}
      </p>
      <Button
        variant="outline"
        className="mt-3 w-full rounded-xl"
        onClick={() => void sync.run()}
        disabled={sync.busy}
        data-testid="sync-now"
      >
        <RefreshCw className={`size-4${sync.busy ? ' animate-spin' : ''}`} aria-hidden />
        {sync.busy ? 'Syncing…' : 'Sync now'}
      </Button>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        If this device stopped picking up changes (phones pause background apps to save battery),
        tap Sync now — the first sync of a session re-verifies everything on both sides, and every
        sync after that only moves the changes the cloud hasn&apos;t seen yet.
      </p>
    </Section>
  );
}

function ThresholdCard() {
  const badThreshold = useAppStore((s) => s.profile.settings.defaultRatingThresholds.badThreshold);
  const updateThresholds = useAppStore((s) => s.updateThresholds);

  // Live preview: a 45-minute task against the current threshold
  const previewMinutes = 45;
  const badAt = previewMinutes * badThreshold;

  return (
    <Section icon={Gaugeish} title="Rating thresholds" testid="threshold-card">
      <p className="text-sm text-muted-foreground">
        Where &quot;over plan&quot; becomes &quot;way over plan&quot;. Tunable per user — some
        people&apos;s tolerance is 20% over, others&apos; is 100%.
      </p>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-sm font-medium">Lazy above</span>
        <span className="font-mono text-lg font-bold tabular-nums" data-testid="threshold-value">
          {badThreshold.toFixed(1)}×
        </span>
      </div>
      <Slider
        className="mt-2"
        value={[badThreshold]}
        min={1.1}
        max={3}
        step={0.1}
        onValueChange={([v]) => updateThresholds({ badThreshold: Math.round(v * 10) / 10 })}
        aria-label="Lazy threshold multiplier"
        data-testid="threshold-slider"
      />
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>1.1× strict</span>
        <span>3.0× forgiving</span>
      </div>
      <div className="mt-3 rounded-xl bg-muted/60 px-3.5 py-2.5 text-sm">
        <p>
          <span className="font-medium">Preview:</span> a {previewMinutes}-minute task is{' '}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">excellent</span> up
          to {previewMinutes}m,{' '}
          <span className="font-semibold text-amber-600 dark:text-amber-400">bad</span> up to{' '}
          {formatDuration(badAt * 60)}, and{' '}
          <span className="font-semibold text-rose-600 dark:text-rose-400">lazy</span> beyond that.
        </p>
      </div>
    </Section>
  );
}

// Small alias to keep Section's icon typing happy without another import chain.
function Gaugeish(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

/** Per-browser unblock instructions — shared by the inline hint + toast. */
const NOTIFICATION_HINTS = {
  ios:
    'On iPhone/iPad, web notifications only work in the installed app: open this site in Safari, tap Share → “Add to Home Screen”, then open it from the home screen icon (iOS 16.4+).',
  insecure:
    'Notifications need a secure connection. Open the app over https:// — or via http://localhost on this computer.',
  denied:
    'Notifications are blocked for this site. Tap the ⓘ / lock icon in the address bar → Site settings → allow Notifications, then flip this on again.',
  unsupported:
    'This browser doesn’t support web notifications. Try Chrome or Safari, or install the app to your Home Screen.',
} as const;

function NotificationsCard() {
  const enabled = useAppStore((s) => s.profile.settings.notificationsEnabled);
  const setNotificationsEnabled = useAppStore((s) => s.setNotificationsEnabled);
  // Notification APIs differ per browser and are not reactive — read them
  // after mount, and re-read after every enable attempt so a fresh denial
  // immediately surfaces the matching instructions.
  const mounted = useMounted();
  const [attempt, setAttempt] = useState(0);
  const support = useMemo(
    () => (mounted ? notificationSupport() : null),
    [mounted, attempt]
  );

  const blockerHint = support && !support.ok ? NOTIFICATION_HINTS[support.reason] : null;

  return (
    <Section icon={Bell} title="Notifications">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Over-time alerts &amp; start reminders</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When a timer passes its planned time — and a 10-minute heads-up before each scheduled task.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={async (v) => {
            const ok = await setNotificationsEnabled(v);
            if (v && !ok) {
              setAttempt((a) => a + 1);
              const fresh = notificationSupport();
              const why = !fresh.ok
                ? NOTIFICATION_HINTS[fresh.reason]
                : 'Enable notifications for this site in your browser settings.';
              toast.error('Couldn’t enable notifications', {
                description: why,
                duration: 8000,
              });
            }
          }}
          aria-label="Enable timer notifications"
          data-testid="notifications-switch"
        />
      </div>

      {/* Platform truth: mobile browsers block this in specific ways — tell
          the user exactly how to unblock instead of a dead toggle. */}
      {blockerHint && (
        <p
          className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          data-testid="notifications-blocker-hint"
        >
          {blockerHint}
        </p>
      )}

      {enabled && support?.ok && (
        <button
          onClick={() => {
            notifications.notify('Test notification', 'This is how alerts will look — task name, time, and what to do next.');
            toast('Test notification sent', {
              description: 'If nothing appeared, check the browser’s notification settings.',
            });
          }}
          className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          data-testid="notifications-test"
        >
          <Bell className="size-3.5" aria-hidden />
          Send a test notification
        </button>
      )}
    </Section>
  );
}

/**
 * AI note review opt-in (plan P5 + §7). Off until enabled here; enabling
 * shows the disclosure and asks for the user's OWN provider key (BYOK —
 * plan §6.1). The key lives in its own localStorage entry, outside the
 * synced store, and can be removed in one tap. Usage shows the daily cap.
 */
function AiCard() {
  const aiEnabled = useAppStore((s) => s.aiEnabled);
  const setAiEnabled = useAppStore((s) => s.setAiEnabled);

  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [tick, setTick] = useState(0); // refresh non-reactive key/usage reads

  const hasKey = tick >= 0 && getApiKey().length > 0;
  const keyMask = describeApiKey();
  const used = tick >= 0 ? getUsageToday() : 0;

  const saveKey = () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    setKeyDraft('');
    setEditingKey(false);
    setTick((t) => t + 1);
    toast.success('API key saved', { description: 'Stored on this device only — never synced.' });
  };

  const removeKey = () => {
    clearApiKey();
    setTick((t) => t + 1);
    toast('API key removed from this device');
  };

  return (
    <Section icon={Sparkles} title="AI note review" testid="ai-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Check notes for unclear wording or grammar</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            An editor that flags unclear spots and suggests fixes — it never changes your note on its own.
          </p>
        </div>
        <Switch
          checked={aiEnabled}
          onCheckedChange={(on) => {
            setAiEnabled(on);
            if (on) setEditingKey(!getApiKey());
          }}
          aria-label="Enable AI note review"
          data-testid="ai-switch"
        />
      </div>

      {aiEnabled && (
        <div className="mt-3 space-y-3">
          {/* Disclosure — stated plainly, once, at opt-in (plan §7). */}
          <p
            className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
            data-testid="ai-disclosure"
          >
            To review a note, its text and the linked task title are sent from your device to
            OpenAI, using your own API key. Your notes stay in your account and on this device,
            reviews you keep are stored in your app data, and your key is stored only on this
            device.
          </p>

          {/* Key custody — BYOK, device-local (plan §6.1). */}
          {hasKey && !editingKey ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono text-xs tabular-nums">{keyMask}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => {
                    setKeyDraft('');
                    setEditingKey(true);
                  }}
                  data-testid="ai-key-replace"
                >
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg text-xs text-destructive hover:text-destructive"
                  onClick={removeKey}
                  data-testid="ai-key-remove"
                >
                  Remove
                </Button>
              </span>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border px-3 py-2.5">
              <Label htmlFor="ai-key" className="text-sm">
                OpenAI API key
              </Label>
              <Input
                id="ai-key"
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                aria-label="OpenAI API key"
                data-testid="ai-key-input"
              />
              <div className="flex items-center justify-between gap-2">
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  data-testid="ai-key-link"
                >
                  Get an API key
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="flex gap-1.5">
                  {hasKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg text-xs"
                      onClick={() => setEditingKey(false)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-8 rounded-lg text-xs"
                    disabled={!keyDraft.trim()}
                    onClick={saveKey}
                    data-testid="ai-key-save"
                  >
                    Save key
                  </Button>
                </span>
              </div>
              {!hasKey && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The key is stored on this device only and never synced. For extra privacy, open
                  your OpenAI account → Data controls and turn off training on API data.
                </p>
              )}
            </div>
          )}

          {/* Usage vs. the daily cap (plan §6.3). */}
          <p className="text-xs tabular-nums text-muted-foreground" data-testid="ai-usage">
            {used} of {DAILY_REVIEW_CAP} reviews used today · re-reading a saved review is free
          </p>
        </div>
      )}
    </Section>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const options = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
  ] as const;

  return (
    <Section icon={Moon} title="Appearance">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {options.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTheme(id)}
            aria-pressed={mounted && theme === id}
            className={cn(
              'flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all',
              mounted && theme === id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function ArchivedCard() {
  const tasksRecord = useAppStore((s) => s.tasks);
  const archived = useMemo(() => selectArchivedTasks(tasksRecord), [tasksRecord]);
  const restoreTask = useAppStore((s) => s.restoreTask);

  if (archived.length === 0) return null;

  return (
    <Section icon={ArchiveRestore} title={`Archived tasks (${archived.length})`}>
      <ul className="flex flex-col gap-2">
        {archived.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm">{t.title}</p>
              <p className="text-xs text-muted-foreground">{formatDuration(t.expectedDurationMinutes * 60)} planned</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 rounded-lg text-xs"
              onClick={() => {
                restoreTask(t.id);
                toast.success(`Restored "${t.title}"`);
              }}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DataCard() {
  const loadDemoData = useAppStore((s) => s.loadDemoData);
  const resetAll = useAppStore((s) => s.resetAll);

  // Read the freshest state at click time rather than subscribing —
  // export is a one-shot action, not reactive UI.
  const exportJson = () => {
    const state = useAppStore.getState();
    downloadTextFile(
      `structure-planner-export-${dateKeyOf(new Date())}.json`,
      'application/json',
      buildExportJson({
        tasks: Object.values(state.tasks),
        logs: Object.values(state.logs),
        notes: Object.values(state.notes),
      })
    );
    toast.success('Backup downloaded', { description: 'JSON with your tasks, sessions, and notes.' });
  };

  const exportCsv = () => {
    const state = useAppStore.getState();
    downloadTextFile(
      `structure-planner-sessions-${dateKeyOf(new Date())}.csv`,
      'text/csv',
      buildExportCsv(Object.values(state.logs))
    );
    toast.success('Sessions downloaded', { description: 'CSV you can open in any spreadsheet.' });
  };

  return (
    <Section icon={Database} title="Data">
      <p className="text-sm text-muted-foreground">
        Everything lives on this device (offline-first). Signing in with Google syncs your data to
        Firestore, so your devices stay in step. Keep an offline backup with the exporters below.
      </p>
      <div className="mt-3 flex gap-2" data-testid="export-row">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={exportJson} data-testid="export-json">
          <Download className="size-4" aria-hidden />
          Export JSON
        </Button>
        <Button variant="outline" className="flex-1 rounded-xl" onClick={exportCsv} data-testid="export-csv">
          <Download className="size-4" aria-hidden />
          Export CSV
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          variant="outline"
          className="flex-1 rounded-xl"
          onClick={() => {
            loadDemoData();
            toast.success('Demo data loaded', { description: 'Two weeks of sample history.' });
          }}
          data-testid="load-demo"
        >
          Load demo data
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              data-testid="reset-data"
            >
              <Trash2 className="size-4" aria-hidden />
              Reset all
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-sm rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Reset everything?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears all tasks, logs, and settings on this device — export first if you want
                a backup. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl">Keep my data</AlertDialogCancel>
              <AlertDialogAction
                className="rounded-xl bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  resetAll();
                  toast.success('All data reset — a fresh start.');
                }}
              >
                Reset everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Section>
  );
}

function AboutCard() {
  return (
    <Section icon={Infoish} title="About">
      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Structure Planner · v0.1.0</p>
        <p>
          Timestamp-based timers, suggested ratings you confirm or override, and a local-first
          store designed for a drop-in Firestore adapter and a future Capacitor wrapper.
        </p>
      </div>
    </Section>
  );
}

function Infoish(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
