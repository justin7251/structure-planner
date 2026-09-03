'use client';

import { useAuthStore } from '@/store/use-auth-store';
import { useAppStore } from '@/store/use-app-store';
import { useMounted } from '@/hooks/use-ticker';
import { AppShell } from '@/components/app-shell';
import { Landing } from '@/components/landing';

/**
 * Single-route gate (§7 keeps the route surface at "/" for Capacitor):
 *   - signed in                          → app (cloud-backed)
 *   - returning visitor (entered before) → app (local or cloud)
 *   - first-time visitor                 → Structured-style landing
 * A splash covers the auth-session restore window so a signed-in reload
 * never flashes the landing page.
 */
export function AppGate() {
  const mounted = useMounted();
  const authStatus = useAuthStore((s) => s.status);
  const hasEnteredApp = useAppStore((s) => s.hasEnteredApp);

  if (!mounted || authStatus === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-10 animate-pulse rounded-full border-[3px] border-primary border-t-transparent" />
          <p className="text-sm">Structure Planner…</p>
        </div>
      </div>
    );
  }

  const showApp = authStatus === 'signedIn' || hasEnteredApp;
  return showApp ? <AppShell /> : <Landing />;
}
