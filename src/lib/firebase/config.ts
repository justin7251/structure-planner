import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

/**
 * Firebase Web SDK config, sourced from NEXT_PUBLIC_ env vars.
 *
 * Setup (see .env.local.example):
 *   1. console.firebase.google.com → create/open a project
 *   2. Project settings → Your apps → Web app → copy the SDK config
 *   3. Paste the values into `.env.local` and restart the dev server
 *   4. Authentication → Sign-in method → enable "Google"
 *   5. Firestore Database → Create database (production or test mode)
 *   6. Deploy `firestore.rules` (or paste it in Console → Firestore → Rules)
 *   7. Authentication → Settings → Authorized domains → add the domain
 *      the app is opened from (shown inside the Settings → Account card)
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** True only when the minimum viable auth + Firestore config is present. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!app) app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

/** Lazily initialize (and memoize) the shared Firebase app + Auth instance. */
export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(ensureApp());
  return auth;
}

/**
 * Firestore with IndexedDB-backed offline persistence and multi-tab
 * support — the app stays fully usable offline and every write made
 * offline is replayed by the SDK once connectivity returns.
 */
export function getFirebaseDb(): Firestore {
  if (!db) {
    db = initializeFirestore(ensureApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return db;
}
