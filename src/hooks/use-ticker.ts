'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * True after the first client render — gates persisted-store reads to
 * avoid SSR hydration mismatch. Implemented with useSyncExternalStore
 * (client snapshot true, server snapshot false) rather than an effect
 * setState, per React's recommended hydration pattern.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/**
 * Re-render trigger for the live timer display.
 *
 * IMPORTANT (§4.1): the interval is purely cosmetic — it never measures
 * time. Elapsed is always recomputed as Date.now() - startedAt at render
 * time, so throttling/suspension of this interval loses nothing.
 * Also bumps immediately on visibility change / focus (§4.4 foreground
 * recovery).
 */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);

    const bump = () => setTick((t) => t + 1);
    window.addEventListener('visibilitychange', bump);
    window.addEventListener('focus', bump);

    return () => {
      window.clearInterval(id);
      window.removeEventListener('visibilitychange', bump);
      window.removeEventListener('focus', bump);
    };
  }, [active, intervalMs]);

  return tick;
}
