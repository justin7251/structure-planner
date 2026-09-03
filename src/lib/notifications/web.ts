/**
 * §6 — Web Notifications API implementation.
 */
export type WebNotificationsAdapter = {
  requestPermission(): Promise<boolean>;
  notify(title: string, body: string, opts?: NotificationOpts): void;
};

/**
 * Extra delivery hints. `tag` coalesces duplicates: a new notification
 * with the same tag replaces the standing one instead of stacking
 * (e.g. the "over plan" alert replaces the "time's up" alert).
 */
export type NotificationOpts = { tag?: string };

const supported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

function show(title: string, body: string, opts?: NotificationOpts) {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: opts?.tag,
    });
    // Actionable: tapping the notification opens/raises the app so the
    // user can act (stop & rate the timer, see the task). Best-effort —
    // mobile browsers only honor this for installed PWAs.
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore — the notification click still dismisses itself
      }
      n.close();
    };
  } catch {
    // Some environments throw on construction — never crash the app for a notification.
  }
}

export const webNotifications: WebNotificationsAdapter = {
  async requestPermission() {
    if (!supported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  notify(title, body, opts) {
    show(title, body, opts);
  },
};

/**
 * Why can't this browser show notifications? Returns the first blocker so
 * the Settings card can explain exactly how to enable them (mobile
 * browsers fail in very specific, very confusing ways):
 *
 *   • 'ios'         — iPhone/iPad Safari only exposes the Notification API
 *                     to Home-Screen-installed PWAs on iOS 16.4+. In a
 *                     normal Safari tab the API simply doesn't exist.
 *   • 'insecure'    — non-HTTPS origins (e.g. opening the dev server over
 *                     the LAN as http://192.168.x.x) are not secure
 *                     contexts; Chrome/Safari remove notification APIs.
 *   • 'denied'      — the user (or a previous prompt) blocked the site.
 *   • 'unsupported' — any other browser without the API (Firefox Focus,
 *                     in-app webviews, etc.).
 */
export type NotificationSupport =
  | { ok: true }
  | { ok: false; reason: 'ios' | 'insecure' | 'denied' | 'unsupported' };

export function notificationSupport(): NotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const iosLike =
      /iP(hone|ad|od)/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return { ok: false, reason: iosLike ? 'ios' : 'unsupported' };
  }
  if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) {
    return { ok: false, reason: 'insecure' };
  }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  return { ok: true };
}
