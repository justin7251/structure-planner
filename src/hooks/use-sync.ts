'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import { syncNow } from '@/lib/sync/firestore-sync';
import { useAuthStore } from '@/store/use-auth-store';

/**
 * Manual "Sync now" — one shared runner for the Today header refresh button
 * and the Settings → Cloud sync card. Talks to the cloud mirror, translates
 * the result into user-facing toasts, and exposes the shared busy state so
 * every button spins/disables together.
 */
export function useSyncNow() {
  const user = useAuthStore((s) => s.user);
  const busy = useAuthStore((s) => s.syncBusy);

  const run = useCallback(async () => {
    const uid = useAuthStore.getState().user?.uid;
    if (!isFirebaseConfigured || !uid) {
      toast.error('Sync needs a Google sign-in', {
        description: 'Until then your data is saved on this device only.',
      });
      return;
    }

    const res = await syncNow(uid);
    if (!res.ok) {
      if (res.reason === 'offline') {
        toast.error("You're offline", {
          description:
            'Changes made offline are kept safely on this device and will sync once you reconnect.',
          duration: 8000,
        });
      } else {
        toast.error('Sync didn’t finish', {
          description: 'Check your connection and tap refresh again.',
          duration: 8000,
        });
      }
      return;
    }

    if (res.pushed === 0 && res.pulled === 0) {
      toast.success('Everything is up to date');
      return;
    }
    const parts = [
      res.pushed > 0
        ? `${res.pushed} change${res.pushed === 1 ? '' : 's'} uploaded`
        : null,
      res.pulled > 0
        ? `${res.pulled} update${res.pulled === 1 ? '' : 's'} received`
        : null,
    ].filter(Boolean);
    toast.success(`Synced — ${parts.join(' · ')}`);
  }, []);

  return { run, busy, canSync: Boolean(user) };
}
