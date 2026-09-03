import { create } from 'zustand';
import type { AuthUser } from '@/lib/firebase/auth';

/**
 * Auth state mirrors Firebase's own persistence (IndexedDB) — this store is
 * intentionally NOT persisted: on every load the provider replays
 * onAuthStateChanged, which fires immediately with the cached user, even
 * offline. Status 'loading' covers the brief restore window.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  /** Last sign-in failure to render inside the Account card. */
  error: { message: string; hint?: string; code?: string } | null;
  signInBusy: boolean;
  /** Last confirmed contact with the cloud (server pull/push cycle). */
  lastSyncAt: string | null;
  /** True while a manual Sync now is running — shared by all buttons. */
  syncBusy: boolean;
  setUser: (user: AuthUser | null) => void;
  setStatus: (status: AuthStatus) => void;
  setError: (error: AuthState['error']) => void;
  setSignInBusy: (busy: boolean) => void;
  setLastSyncAt: (iso: string | null) => void;
  setSyncBusy: (busy: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  error: null,
  signInBusy: false,
  lastSyncAt: null,
  syncBusy: false,
  setUser: (user) =>
    set((state) => ({
      user,
      status: user ? 'signedIn' : state.status === 'loading' ? 'loading' : 'signedOut',
    })),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setSignInBusy: (signInBusy) => set({ signInBusy }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setSyncBusy: (syncBusy) => set({ syncBusy }),
}));

