'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck2,
  ChartNoAxesColumn,
  LayoutGrid,
  Mail,
  ShieldCheck,
  Timer,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import {
  sendPasswordReset,
  startEmailSignIn,
  startEmailSignUp,
  startGoogleSignIn,
} from '@/lib/firebase/auth';
import { useAppStore } from '@/store/use-app-store';
import { useAuthStore } from '@/store/use-auth-store';
import { useMounted } from '@/hooks/use-ticker';
import { GoogleMark } from '@/components/google-mark';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Structured.app-style marketing landing: warm pastel palette, rounded
 * type, a living timeline mockup, and honest copy about what the app does.
 * Shown to first-time visitors by the gate in page.tsx; signed-in or
 * returning users never see it.
 */

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.55, ease: 'easeOut' as const },
};

/** Fired by the sign-in error card to open + scroll to the email panel. */
const OPEN_EMAIL_EVENT = 'sp:open-email-auth';

// ── login ─────────────────────────────────────────────────────────────────

function useGoogleLogin() {
  const [busy, setBusy] = useState(false);
  const login = async () => {
    if (!isFirebaseConfigured) {
      toast.info('Google sign-in needs a Firebase project', {
        description: 'Open Settings → Account inside the app for the 2-minute setup guide. The demo works right now.',
        duration: 8000,
      });
      return;
    }
    setBusy(true);
    try {
      const outcome = await startGoogleSignIn();
      if (!outcome) return; // defensive — redirect flow always reports an outcome
      if (outcome.kind === 'redirect') {
        toast('Opening Google sign-in…', { icon: '🔐' });
        return; // page navigates; keep the button busy
      }
      if (outcome.kind === 'error') {
        // Surface persistently on the landing (toast alone is easy to miss).
        useAuthStore
          .getState()
          .setError({ message: outcome.message, hint: outcome.hint, code: outcome.code });
        toast.error(outcome.message, { description: outcome.hint, duration: 12000 });
      }
    } catch {
      // Unexpected throw (config/env problems) — never leave the user
      // staring at a silently unchanged landing page.
      useAuthStore.getState().setError({
        message: "Google sign-in didn't complete.",
        hint: 'Something went wrong starting sign-in — check the Firebase configuration. You can continue without signing in; data stays on this device.',
      });
    } finally {
      setBusy(false);
    }
  };
  return { busy, login };
}

function LoginButton({
  size = 'lg',
  tone = 'primary',
  testid = 'landing-login-btn',
  className,
}: {
  size?: 'lg' | 'md';
  tone?: 'primary' | 'white';
  testid?: string;
  className?: string;
}) {
  const { busy, login } = useGoogleLogin();
  return (
    <button
      onClick={login}
      disabled={busy}
      data-testid={testid}
      className={cn(
        'group inline-flex items-center justify-center gap-2.5 rounded-full font-semibold shadow-lg transition-all active:scale-[0.98] disabled:opacity-70',
        tone === 'primary'
          ? 'bg-primary text-primary-foreground shadow-primary/30 hover:brightness-105'
          : 'bg-white text-[#c14f3f] shadow-black/10 hover:brightness-105',
        size === 'lg' ? 'h-12 px-7 text-[15px]' : 'h-10 px-5 text-sm',
        className,
      )}
    >
      {busy ? (
        <span
          className={cn(
            'size-4 animate-spin rounded-full border-2',
            tone === 'primary' ? 'border-white/40 border-t-white' : 'border-[#c14f3f]/30 border-t-[#c14f3f]',
          )}
          aria-hidden
        />
      ) : (
        <GoogleMark className="size-4 rounded-full bg-white p-[3px]" />
      )}
      {busy ? 'Connecting…' : size === 'md' ? 'Sign in' : 'Continue with Google'}
    </button>
  );
}

function DemoButton({ size = 'lg', testid = 'landing-demo-btn' }: { size?: 'lg' | 'md'; testid?: string }) {
  const enterApp = useAppStore((s) => s.enterApp);
  return (
    <button
      onClick={enterApp}
      data-testid={testid}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98]',
        size === 'lg' ? 'h-12 px-7 text-[15px]' : 'h-10 px-5 text-sm',
      )}
    >
      Try the live demo
      <ArrowRight className="size-4" aria-hidden />
    </button>
  );
}

// ── sign-in error ────────────────────────────────────────────────────────────

/**
 * Persistent explanation for failed sign-ins (Google redirect and email
 * flows both route their failures into the auth store). Critical for
 * supervised child accounts (Family Link): Google bounces the flow back
 * without a session and — without this card — the user would just see the
 * landing page again with no idea why. Offers the honest fallback: use the
 * app signed-out.
 */
function SignInErrorCard() {
  const error = useAuthStore((s) => s.error);
  if (!error) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      role="alert"
      data-testid="landing-error-card"
      className="mt-6 max-w-md rounded-2xl border border-destructive/30 bg-destructive/10 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
          <TriangleAlert className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{error.message}</p>
          {error.hint && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error.hint}</p>
          )}
          {error.code && (
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
              {error.code}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EMAIL_EVENT))}
              data-testid="landing-error-email"
              className="inline-flex h-8 items-center rounded-full border border-primary/40 bg-primary/10 px-3.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              <Mail className="mr-1 size-3.5" aria-hidden />
              Use email instead
            </button>
            <button
              onClick={() => {
                useAuthStore.getState().setError(null);
                useAppStore.getState().enterApp();
              }}
              data-testid="landing-error-continue"
              className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-105 active:scale-[0.98]"
            >
              Continue without sign-in
              <ArrowRight className="ml-1 size-3.5" aria-hidden />
            </button>
            <button
              onClick={() => useAuthStore.getState().setError(null)}
              data-testid="landing-error-dismiss"
              className="inline-flex h-8 items-center rounded-full border border-border px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── email sign-in ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email + password sign-in / registration as an alternative to the Google
 * flow. Works where Google refuses the account at all (supervised child
 * accounts), needs only the Email/Password provider enabled. Errors land
 * in the same persistent SignInErrorCard as the Google flow.
 */
function EmailAuthPanel() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // The sign-in error card sends users straight here — Google refuses
  // supervised child accounts, but email + password never involves Google.
  useEffect(() => {
    const openPanel = () => {
      setOpen(true);
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    window.addEventListener(OPEN_EMAIL_EVENT, openPanel);
    return () => window.removeEventListener(OPEN_EMAIL_EVENT, openPanel);
  }, []);

  const surfaceError = (message: string, hint?: string, code?: string) => {
    useAuthStore.getState().setError({ message, hint, code });
    toast.error(message, { description: hint, duration: 12000 });
  };

  const requireFirebase = () => {
    if (isFirebaseConfigured) return true;
    toast.info('Sign-in needs a Firebase project', {
      description:
        'Open Settings → Account inside the app for the 2-minute setup guide. The demo works right now.',
      duration: 8000,
    });
    return false;
  };

  const submit = async () => {
    if (!requireFirebase()) return;
    const clean = email.trim();
    if (!EMAIL_RE.test(clean)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (password.length < 6) {
      toast.error('Password needs at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      const outcome =
        mode === 'signin'
          ? await startEmailSignIn(clean, password)
          : await startEmailSignUp(clean, password);
      if (!outcome) return; // success — auth provider flips the gate
      if (outcome.kind === 'error') surfaceError(outcome.message, outcome.hint, outcome.code);
    } catch {
      useAuthStore.getState().setError({
        message: "Sign-in didn't complete.",
        hint: 'Something went wrong — check the Firebase configuration (Email/Password provider enabled?).',
      });
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!requireFirebase()) return;
    const clean = email.trim();
    if (!EMAIL_RE.test(clean)) {
      toast.error('Type your email above first, then tap Forgot password');
      return;
    }
    setBusy(true);
    try {
      const outcome = await sendPasswordReset(clean);
      if (!outcome) return; // defensive — reset never resolves null
      if (outcome.kind === 'sent') {
        toast.success('Password reset email sent', {
          description: `Check ${clean} — also look in spam.`,
          duration: 10000,
        });
      } else if (outcome.kind === 'error') {
        surfaceError(outcome.message, outcome.hint, outcome.code);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={panelRef} className="mt-3 w-full max-w-md">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="landing-email-toggle"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <Mail className="size-4" aria-hidden />
        {open ? 'Hide email sign-in' : 'Or sign in with email & password'}
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="landing-email-panel"
          className="mt-3 rounded-2xl border bg-card p-4 shadow-sm"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="landing-email" className="text-xs font-semibold">
                Email
              </Label>
              <Input
                id="landing-email"
                data-testid="landing-email-input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="landing-password" className="text-xs font-semibold">
                Password
              </Label>
              <Input
                id="landing-password"
                data-testid="landing-password-input"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="mt-1.5"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              data-testid="landing-email-submit"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-70"
            >
              {busy ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              ) : null}
              {busy ? 'Connecting…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <button
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
              data-testid="landing-email-switch"
              className="font-semibold text-primary hover:underline"
            >
              {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            </button>
            {mode === 'signin' && (
              <button
                onClick={forgot}
                data-testid="landing-email-reset"
                className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The email is only your login id — it never leaves your own Firebase project. Works
            even when Google refuses a supervised child account.
          </p>
        </motion.div>
      )}
    </div>
  );
}

// ── phone mockup ──────────────────────────────────────────────────────────

const MOCK_BLOCKS = [
  { title: 'Deep work — product deck', time: '09:00 – 10:30', top: 40, height: 96, hex: '#6e96b8', lane: 0 },
  { title: 'Gym session', time: '09:00 – 09:45', top: 40, height: 56, hex: '#9c8bd9', lane: 1 },
  { title: 'Inbox zero', time: '12:30 – 14:00', top: 168, height: 96, hex: '#7dc57d', lane: 0 },
  { title: 'Lunch walk', time: '13:00 – 13:30', top: 200, height: 44, hex: '#f09a54', lane: 1 },
];

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[300px]" aria-hidden>
      {/* pastel blobs */}
      <div className="absolute -left-16 -top-10 size-44 rounded-full bg-[#ee8172]/30 blur-3xl" />
      <div className="absolute -right-14 top-40 size-40 rounded-full bg-[#5fbfb0]/30 blur-3xl" />
      <div className="absolute -bottom-8 left-10 size-36 rounded-full bg-[#9c8bd9]/30 blur-3xl" />

      {/* floating chips */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="absolute -right-8 top-24 z-20 rounded-2xl border bg-card/95 px-3.5 py-2 shadow-xl backdrop-blur"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
          <span className="size-2 animate-pulse rounded-full bg-[#ee8172]" />
          23:14 left
        </p>
        <p className="text-[10px] text-muted-foreground">Deep work · running</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="absolute -left-10 bottom-24 z-20 rounded-2xl border bg-card/95 px-3.5 py-2 shadow-xl backdrop-blur"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#3d7f46] dark:text-[#a8dca8]">
          <BadgeCheck className="size-3.5" aria-hidden />
          Excellent
        </p>
        <p className="text-[10px] text-muted-foreground">12m ahead of plan</p>
      </motion.div>

      {/* phone body */}
      <div className="relative z-10 rounded-[2.6rem] border-[6px] border-foreground/90 bg-background shadow-2xl">
        <div className="overflow-hidden rounded-[2.1rem]">
          {/* status bar */}
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[10px] font-semibold text-muted-foreground">
            <span>9:41</span>
            <span className="h-3.5 w-14 rounded-full bg-foreground/90" />
            <span className="flex gap-1">
              <span className="h-2 w-3.5 rounded-[2px] bg-foreground/70" />
              <span className="h-2 w-2 rounded-[2px] bg-foreground/70" />
            </span>
          </div>
          {/* date header */}
          <div className="px-4 pt-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Plan</p>
            <p className="text-lg font-bold tracking-tight">Today · 14 March</p>
            <div className="mt-2 flex justify-between px-0.5">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <span className={cn('text-[9px]', i === 5 ? 'font-bold text-[#ee8172]' : 'text-muted-foreground')}>{d}</span>
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded-full text-[9px] font-semibold',
                      i === 5 ? 'bg-[#ee8172] text-white' : 'text-muted-foreground/70',
                    )}
                  >
                    {9 + i}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* mini timeline */}
          <div className="relative mx-3 mb-4 mt-3 h-[300px] rounded-2xl bg-muted/50 p-2">
            {MOCK_BLOCKS.map((b) => (
              <div
                key={b.title}
                className={cn('absolute rounded-xl border px-2 py-1', b.lane === 1 ? 'w-[46%] right-2' : 'w-[52%] left-2')}
                style={{ top: b.top, height: b.height, backgroundColor: `${b.hex}2e`, borderColor: `${b.hex}96` }}
              >
                <p className="truncate text-[9px] font-bold" style={{ color: b.hex }}>
                  {b.title}
                </p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">{b.time}</p>
              </div>
            ))}
            {/* now line */}
            <div className="absolute inset-x-2 top-[150px] flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-[#ee8172]" />
              <span className="h-px flex-1 bg-[#ee8172]" />
              <span className="rounded-full bg-[#ee8172] px-1.5 py-px text-[8px] font-bold text-white">now</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── sections ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: LayoutGrid,
    hex: '#ee8172',
    title: 'A day you can see',
    body: 'Every task is a color block on a 24-hour timeline. Drag to reschedule, pull the edge to resize — the plan and reality share one canvas.',
  },
  {
    icon: Timer,
    hex: '#5fbfb0',
    title: 'A timer that never lies',
    body: 'Elapsed time is computed from timestamps, so a refresh, a background tab, or a killed app never loses a second.',
  },
  {
    icon: BadgeCheck,
    hex: '#7dc57d',
    title: 'Ratings you can trust',
    body: 'The app suggests Excellent, Bad, or Lazy from your real numbers — you confirm or override, and the suggestion is always preserved.',
  },
  {
    icon: ChartNoAxesColumn,
    hex: '#9c8bd9',
    title: 'Insights that bite',
    body: 'A 14-day trend of your estimate ratio shows exactly when your "one hour" quietly means ninety minutes.',
  },
  {
    icon: WifiOff,
    hex: '#6e96b8',
    title: 'Offline-first, always',
    body: 'Install it as a PWA and plan with zero connection. Firestore queues every change and replays it the moment you are back online.',
  },
  {
    icon: ShieldCheck,
    hex: '#e58bb4',
    title: 'Your cloud, your rules',
    body: 'Sign in with Google and your data syncs to a private per-user Firestore tree guarded by security rules. Sign out and it stays on-device.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Plan',
    body: 'Drop tasks onto the timeline with a color, a glyph, and an honest estimate of how long they should take.',
  },
  {
    n: '2',
    title: 'Track',
    body: 'Start the drift-proof clock and go. Even if the app dies mid-session, the timestamps survive and recover.',
  },
  {
    n: '3',
    title: 'Reflect',
    body: 'Stop, read the suggestion, confirm or override it. Watch your over-plan ratio shrink week over week.',
  },
];

export function Landing() {
  const mounted = useMounted();

  return (
    <div className="min-h-dvh bg-background" data-testid="landing">
      {/* ── nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-lg">
        <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6" aria-label="Main">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
              <CalendarCheck2 className="size-5" aria-hidden />
            </span>
            <span className="hidden text-[17px] font-bold tracking-tight min-[420px]:block">Structure Planner</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <DemoButton size="md" testid="landing-demo-btn-nav" />
            </div>
            <LoginButton size="md" testid="landing-login-btn-nav" />
          </div>
        </nav>
      </header>

      <main>
        {/* ── hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
          <div className="mx-auto grid max-w-5xl items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={mounted ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
                Plan · Track · Reflect honestly
              </span>
              <h1 className="mt-5 text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
                Own your day.
                <br />
                <span className="text-primary">Know your hours.</span>
              </h1>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground sm:text-lg">
                Structure Planner lays your day on a living timeline, times every task with a
                drift-proof clock, and turns what actually happened into sharper estimates.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <LoginButton />
                <DemoButton />
              </div>
              <EmailAuthPanel />
              <SignInErrorCard />
              <p className="mt-4 text-xs text-muted-foreground">
                The demo runs entirely on this device — no account needed. Sign in to sync via your
                own Firebase + Firestore.
              </p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={mounted ? { opacity: 1, scale: 1 } : undefined}
              transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
            >
              <PhoneMockup />
            </motion.div>
          </div>
        </section>

        {/* ── features ─────────────────────────────────────────── */}
        <section className="px-4 py-20 sm:px-6" aria-label="Features">
          <div className="mx-auto max-w-5xl">
            <motion.div {...fadeUp} className="mx-auto max-w-xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Everything serves the honest number
              </h2>
              <p className="mt-3 text-muted-foreground">
                Not another todo list — a feedback loop between what you planned, what you did, and
                what you learn from it.
              </p>
            </motion.div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <motion.article
                  key={f.title}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: (i % 3) * 0.08 }}
                  className="group rounded-3xl border bg-card p-6 transition-shadow hover:shadow-lg hover:shadow-foreground/5"
                >
                  <span
                    className="grid size-11 place-items-center rounded-2xl"
                    style={{ backgroundColor: `${f.hex}26`, color: f.hex }}
                  >
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-[15px] font-bold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* ── how it works ─────────────────────────────────────── */}
        <section className="px-4 py-20 sm:px-6" aria-label="How it works">
          <div className="mx-auto max-w-5xl">
            <motion.h2 {...fadeUp} className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
              Three moves, repeated daily
            </motion.h2>
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s.n}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: i * 0.1 }}
                  className="relative rounded-3xl border bg-card p-6"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-primary/12 text-lg font-extrabold text-primary">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── insights band ────────────────────────────────────── */}
        <section className="px-4 py-10 sm:px-6" aria-label="Insights preview">
          <motion.div
            {...fadeUp}
            className="mx-auto max-w-5xl rounded-[2.5rem] bg-[#1d1c22] px-6 py-14 text-white sm:px-12"
          >
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Two weeks in, you&apos;ll see yourself clearly
              </h2>
              <p className="mt-3 text-sm text-white/70 sm:text-base">
                The app doesn&apos;t flatter you. It counts. Numbers below come from the built-in
                demo dataset — reset anytime for a fresh start.
              </p>
            </div>
            <dl className="mt-10 grid gap-8 text-center sm:grid-cols-3">
              {[
                { v: '1.08×', k: 'average actual-vs-planned ratio across 97 demo sessions' },
                { v: '29h 7m', k: 'honest tracked time in the two demo weeks' },
                { v: '3 taps', k: 'from stopping the timer to a confirmed reflection' },
              ].map((s) => (
                <div key={s.v}>
                  <dt className="sr-only">{s.k}</dt>
                  <dd>
                    <span className="block text-4xl font-extrabold tracking-tight text-[#f5a899] sm:text-5xl">
                      {s.v}
                    </span>
                    <span className="mt-2 block text-xs leading-relaxed text-white/65">{s.k}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </section>

        {/* ── final CTA ────────────────────────────────────────── */}
        <section className="px-4 py-20 sm:px-6">
          <motion.div
            {...fadeUp}
            className="relative mx-auto max-w-3xl overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[#ee8172] to-[#e58bb4] px-6 py-14 text-center text-white shadow-xl shadow-primary/20 sm:px-12"
          >
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Start your most honest week yet
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/85 sm:text-base">
              Plan tomorrow in two minutes tonight. Your future estimates will thank you.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <LoginButton tone="white" />
              <button
                onClick={() => useAppStore.getState().enterApp()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/50 px-7 text-[15px] font-semibold text-white transition-all hover:bg-white/10 active:scale-[0.98]"
              >
                Try the demo
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </motion.div>
        </section>
      </main>

      {/* ── footer ───────────────────────────────────────────── */}
      <footer className="border-t border-border/60 px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-xl bg-primary text-primary-foreground">
              <CalendarCheck2 className="size-4" aria-hidden />
            </span>
            <span className="text-sm font-bold">Structure Planner</span>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Firebase Auth · Firestore offline persistence · Next.js PWA
          </p>
          <p className="text-xs text-muted-foreground">© 2026 Structure Planner</p>
        </div>
      </footer>
    </div>
  );
}
