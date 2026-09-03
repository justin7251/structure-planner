/**
 * §6 — Web implementation: Vibration API where available, silent no-op
 * otherwise (iOS Safari has no web vibration — native wrapper will).
 */

type VibrateFn = (pattern: number | number[]) => boolean;

function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { vibrate?: VibrateFn };
  try {
    nav.vibrate?.(pattern);
  } catch {
    // Haptics must never break a user flow.
  }
}

export const webHaptics = {
  light() {
    vibrate(10);
  },
  success() {
    vibrate([15, 40, 25]);
  },
  warning() {
    vibrate([30, 30, 30]);
  },
};
