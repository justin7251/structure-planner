import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from './config';

/** Minimal serializable identity used by the UI + future Firestore paths. */
export type AuthUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

/**
 * Result of an attempted sign-in:
 *  - null                  → signed in (onAuthStateChanged will fire)
 *  - { kind: 'redirect' }  → page is about to navigate to Google, keep UI busy
 *  - { kind: 'sent' }      → password-reset email is on its way
 *  - { kind: 'error' }     → show message (+ optional hint, raw code) to the user
 */
export type SignInOutcome =
  | null
  | { kind: 'redirect' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string; hint?: string; code?: string };

export function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

/**
 * Attach the raw Firebase error code to a mapped outcome so the UI can show
 * it as a technical detail — the single most useful thing for debugging
 * sign-in problems remotely (Family Link refusals, domain misconfig, ...).
 */
function withCode(outcome: SignInOutcome, error: unknown): SignInOutcome {
  if (outcome?.kind === 'error' && !outcome.code) {
    const code = errorCode(error);
    if (code) return { ...outcome, code };
  }
  return outcome;
}

/**
 * Redirect sign-ins navigate away and back, so the only way to know "we just
 * came from Google and got nothing" is a flag written before the navigation.
 * Without it, an aborted/refused flow (Google child accounts, closed window)
 * returns to the landing page completely silently.
 */
const REDIRECT_PENDING_KEY = 'sp:redirect-signin-pending';
const REDIRECT_PENDING_TTL_MS = 15 * 60 * 1000;

function markRedirectPending(): void {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode etc.) — detection just degrades.
  }
}

function consumeRedirectPending(): boolean {
  try {
    const raw = sessionStorage.getItem(REDIRECT_PENDING_KEY);
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < REDIRECT_PENDING_TTL_MS;
  } catch {
    return false;
  }
}

function mapSignInError(error: unknown): SignInOutcome {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'this domain';
  switch (errorCode(error)) {
    case 'auth/unauthorized-domain':
      return {
        kind: 'error',
        message: "This domain isn't authorized for Google sign-in.",
        hint: `Firebase Console → Authentication → Settings → Authorized domains → add "${origin}".`,
      };
    case 'auth/operation-not-allowed':
      return {
        kind: 'error',
        message: 'Google sign-in is disabled for this Firebase project.',
        hint: 'Firebase Console → Authentication → Sign-in method → enable "Google".',
      };
    case 'auth/network-request-failed':
      return {
        kind: 'error',
        message: "You seem to be offline — sign-in needs a connection.",
        hint: 'Reconnect and try again. Everything else keeps working offline.',
      };
    case 'auth/web-storage-unsupported':
      return {
        kind: 'error',
        message: 'This browser is blocking what sign-in needs (storage/cookies).',
        hint: 'Allow cookies and site data for this site — supervised Chrome profiles often lock this — or try another browser.',
      };
    case 'auth/user-disabled':
    case 'auth/admin-restricted-operation':
      return {
        kind: 'error',
        message: "Google won't let this account sign in here.",
        hint: "The account is restricted — supervised child accounts (Family Link) can't sign in to third-party apps until a parent approves it, and Google blocks under-13 accounts entirely in many regions. Use the Email tab below instead — a plain email + password login doesn't involve Google.",
      };
    default:
      return {
        kind: 'error',
        message: "Google sign-in didn't complete.",
        hint: "Common causes: the Google window was closed, a network hiccup, or a restricted account — supervised child accounts (Family Link) often can't sign in to third-party apps. Try the Email tab below, or continue without signing in; data stays on this device.",
      };
  }
}

/**
 * Kick off Google sign-in. Redirect-only by design: popups are blocked or
 * break silently in installed PWAs, iOS Safari, and supervised (Family Link)
 * browsers — the full-page redirect works in all of them and funnels every
 * failure through one consistent error path (watchAuth + the pending flag).
 */
export async function startGoogleSignIn(): Promise<SignInOutcome> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  // Always show the account chooser — avoids silent re-auth of a stale
  // account after sign-out, and lets multi-account users pick correctly.
  provider.setCustomParameters({ prompt: 'select_account' });

  markRedirectPending();
  try {
    await signInWithRedirect(auth, provider);
    return { kind: 'redirect' };
  } catch (error) {
    // Redirect can fail BEFORE navigating (domain checks, offline, config).
    // Map it like any other failure instead of leaking an unhandled
    // rejection — and drop the pending flag so the next load stays clean.
    consumeRedirectPending();
    console.error('[auth] Google sign-in failed before redirect:', error);
    return withCode(mapSignInError(error), error);
  }
}

/**
 * Email + password sign-in (Firebase "Email/Password" provider). A practical
 * alternative when Google refuses the account entirely — e.g. supervised
 * child accounts (Family Link), which often can't approve third-party apps.
 */
function mapEmailError(error: unknown): SignInOutcome {
  switch (errorCode(error)) {
    case 'auth/operation-not-allowed':
      return {
        kind: 'error',
        message: 'Email & password sign-in is disabled for this Firebase project.',
        hint: 'Firebase Console → Authentication → Sign-in method → enable "Email/Password".',
      };
    case 'auth/invalid-email':
      return {
        kind: 'error',
        message: "That email address doesn't look right.",
        hint: 'Check for typos — it must be a real email like you@example.com.',
      };
    case 'auth/missing-password':
      return { kind: 'error', message: 'Please enter a password.' };
    case 'auth/weak-password':
      return {
        kind: 'error',
        message: 'That password is too weak.',
        hint: 'Use at least 6 characters.',
      };
    case 'auth/email-already-in-use':
      return {
        kind: 'error',
        message: 'An account with this email already exists.',
        hint: 'Sign in instead — or use "Forgot password" to get a reset email.',
      };
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return {
        kind: 'error',
        message: 'Wrong email or password.',
        hint: 'Double-check both, or tap "Forgot password" for a reset email.',
      };
    case 'auth/too-many-requests':
      return {
        kind: 'error',
        message: 'Too many attempts.',
        hint: 'Wait a minute and try again.',
      };
    case 'auth/user-disabled':
      return {
        kind: 'error',
        message: 'This account has been disabled.',
        hint: 'Firebase Console → Authentication → Users → re-enable the account.',
      };
    default:
      return {
        kind: 'error',
        message: "Sign-in didn't complete.",
        hint: 'Something went wrong — try again in a moment. You can continue without signing in; data stays on this device.',
      };
  }
}

/** Sign in with an existing email + password account. null → signed in. */
export async function startEmailSignIn(email: string, password: string): Promise<SignInOutcome> {
  try {
    await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    return null;
  } catch (error) {
    console.error('[auth] email auth failed:', error);
    return withCode(mapEmailError(error), error);
  }
}

/** Create a new email + password account. null → signed in. */
export async function startEmailSignUp(email: string, password: string): Promise<SignInOutcome> {
  try {
    await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    return null;
  } catch (error) {
    console.error('[auth] email auth failed:', error);
    return withCode(mapEmailError(error), error);
  }
}

/** Send a password-reset email. { kind: 'sent' } → mail is on its way. */
export async function sendPasswordReset(email: string): Promise<SignInOutcome> {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email);
    return { kind: 'sent' };
  } catch (error) {
    console.error('[auth] email auth failed:', error);
    return withCode(mapEmailError(error), error);
  }
}

/** Sign the current user out (no-op-safe when nothing is configured). */
export async function signOutGoogleUser(): Promise<void> {
  await signOut(getFirebaseAuth());
}

/**
 * Subscribe to auth state. Also resolves any pending redirect sign-in
 * (returns the freshly signed-in user via onRedirectSignIn) and surfaces
 * redirect-flow failures (e.g. unauthorized domain) as mapped outcomes.
 *
 * Returns an unsubscribe function.
 */
export function watchAuth(handlers: {
  onUser: (user: AuthUser | null) => void;
  onRedirectSignIn?: (user: AuthUser) => void;
  onRedirectError?: (outcome: SignInOutcome) => void;
}): () => void {
  const auth = getFirebaseAuth();
  const { onUser, onRedirectSignIn, onRedirectError } = handlers;

  getRedirectResult(auth)
    .then((credential) => {
      const wasPending = consumeRedirectPending();
      if (credential?.user) {
        onRedirectSignIn?.(toAuthUser(credential.user));
        return;
      }
      // Navigated to Google and back with no signed-in session: the flow was
      // aborted (window closed / Back pressed) or Google refused the account
      // (typical for supervised child accounts). Never stay silent — the user
      // would otherwise just see the landing page with no explanation.
      if (wasPending && onRedirectError) {
        onRedirectError({
          kind: 'error',
          message: 'Google sent you back without signing in.',
          hint: "Google came back with no signed-in session — the flow was cancelled, or Google refused this account. Supervised child accounts (Family Link) often can't sign in to third-party apps until a parent approves it. Use the Email tab below instead — it works for child accounts too.",
        });
      }
    })
    .catch((error) => {
      consumeRedirectPending();
      console.error('[auth] Google redirect sign-in failed:', error);
      onRedirectError?.(withCode(mapSignInError(error), error));
    });

  return onAuthStateChanged(auth, (user) => {
    onUser(user ? toAuthUser(user) : null);
  });
}
