/**
 * §6 — Notifications abstraction.
 *
 * The rest of the app imports `notifications` from this index only —
 * never the platform file directly. The implementation is selected at
 * this single entry point, so a future Capacitor wrapper is a drop-in
 * swap (replace the import with the @capacitor/local-notifications impl).
 */
import type { NotificationOpts, WebNotificationsAdapter } from './web';

export interface NotificationsAdapter {
  /** Returns true when permission is granted (web: Notification API). */
  requestPermission(): Promise<boolean>;
  /** Fire a notification now (no-op when unsupported/denied). */
  notify(title: string, body: string, opts?: NotificationOpts): void;
}

export type { NotificationOpts, WebNotificationsAdapter };

import { webNotifications } from './web';

/** Single selection point — swap to the Capacitor implementation later. */
export const notifications: NotificationsAdapter = webNotifications;
