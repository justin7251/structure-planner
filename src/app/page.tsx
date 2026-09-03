import { AppGate } from '@/components/app-gate';

/**
 * Structure Planner — single-route PWA (§7). AppGate composes the
 * Structured-style landing and the AppShell tab views, keeping the route
 * surface minimal for a future Capacitor wrapper.
 */
export default function Page() {
  return <AppGate />;
}
