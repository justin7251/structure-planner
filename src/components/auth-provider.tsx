'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import { watchAuth, type AuthUser } from '@/lib/firebase/auth';
import { startFirestoreSync, stopFirestoreSync } from '@/lib/sync/firestore-sync';
import { useAuthStore } from '@/store/use-auth-store';
import { useAppStore } from '@/store/use-app-store';

/**
 * Headless component: opens the single Firebase auth listener for the app,
 * mirrors its events into the auth store, adopts the Google identity into
 * the local profile, and owns the Firestore sync lifecycle. Mounted once
 * in the root layout. Offline-safe — Firebase replays the cached user from
 * IndexedDB, so the session (and cloud data) survives reloads with no
 * network.
 */
export function AuthProvider() {
  const firstEvent = useRef(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      useAuthStore.setState({ status: 'signedOut', user: null });
      return;
    }

    const announce = (user: AuthUser, viaRedirect: boolean) => {
      const wasSignedOut = useAuthStore.getState().status === 'signedOut';
      const restoredQuietly = firstEvent.current && !viaRedirect;
      useAuthStore.getState().setUser(user);
      firstEvent.current = false;
      // Welcome toast only for deliberate sign-ins, not silent session restore.
      if ((viaRedirect || (!restoredQuietly && wasSignedOut)) && user) {
        toast.success(`Signed in as ${user.displayName || user.email || 'new user'}`);
      }
    };

    const unsubscribe = watchAuth({
      onUser: (user) => {
        if (user) {
          announce(user, false);
          // Account-switch guard MUST run before the mirror starts: it wipes
          // a previous account's local data so the first-of-session upload
          // pass can never push it into this user's cloud tree.
          useAppStore.getState().claimDataOwner(user);
          // Cloud mirror lives exactly as long as the session does.
          startFirestoreSync(user.uid);
          useAppStore.getState().adoptAuthUser(user);
        } else {
          stopFirestoreSync();
          useAuthStore.setState({ user: null, status: 'signedOut' });
          firstEvent.current = false;
        }
      },
      onRedirectSignIn: (user) => {
        announce(user, true);
        useAppStore.getState().claimDataOwner(user);
        startFirestoreSync(user.uid);
        useAppStore.getState().adoptAuthUser(user);
      },
      onRedirectError: (outcome) => {
        if (outcome?.kind === 'error') {
          useAuthStore
            .getState()
            .setError({ message: outcome.message, hint: outcome.hint, code: outcome.code });
          toast.error(outcome.message, {
            description: outcome.hint,
            duration: 12000,
          });
        }
      },
    });

    return () => {
      stopFirestoreSync();
      unsubscribe();
    };
  }, []);

  return null;
}
