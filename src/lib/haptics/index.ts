/**
 * §6 — Haptics abstraction. The app imports `haptics` from this index
 * only; the platform file is selected here, so the Capacitor
 * @capacitor/haptics implementation is a drop-in swap later.
 */
import { webHaptics } from './web';

export interface HapticsAdapter {
  /** Light tap — row taps, small confirmations. */
  light(): void;
  /** Success pattern — completing a timer, accepting a rating. */
  success(): void;
  /** Warning pattern — abandoning, crossing the expected duration. */
  warning(): void;
}

/** Single selection point — swap to the Capacitor implementation later. */
export const haptics: HapticsAdapter = webHaptics;
