# Structure Planner

A daily planning PWA in the spirit of [structured.app](https://structured.app): lay your day
on a 24-hour timeline, time every task with a drift-proof clock, and reflect honestly on how
it went. Built to sharpen your time-estimation instincts — the app remembers what you
*planned* versus what *actually happened*, and shows you the gap.

## Features

- **24-hour timeline** — tasks are colored blocks you can drag to reschedule and resize;
  tap an empty hour to create a task pre-filled at that slot. Anytime tasks live below the grid.
- **Drift-proof timer** — elapsed time is computed from timestamps (`Date.now() - startedAt`),
  so a refresh, a background tab, or a killed app never loses a second.
- **Honest ratings** — when you stop a timer the app suggests Excellent / Bad / Lazy from
  your real numbers against your own thresholds (tunable 1.1×–3.0×). You confirm or override;
  the suggestion is always preserved.
- **Note Taker** — a quick-capture button (pen FAB) for one-line reflections: save a
  standalone quick note in two taps, or flip the toggle to link it to **any** task —
  today's or another day's (arrow through the day picker; completed tasks show their
  finish time, pending ones their slot). Linked notes also surface on the task's action
  modal; everything syncs to the `notes` subcollection when signed in.
- **Calm task form** — the create/edit modal leads with what the task *is* (title, detail,
  schedule, duration). Its look is opt-in: tap the colored banner to change color, tap the
  glyph to change the icon — both pickers stay hidden until asked for.
- **Insights** — a 14-day trend of your estimate ratio, plus per-day history and a
  rate-later queue for sessions you don't want to grade yet.
- **Offline-first** — everything works with zero network. Data lives in `localStorage`
  (Zustand persist); Firestore (when configured) is a synced mirror, not a dependency.
- **Google sign-in + Firestore sync** — optional. Sign in and your tasks, logs, notes, and
  profile mirror to your own Firebase project, isolated per user.

## Quick start

```bash
bun install        # or: npm install (Node >= 20.9)
bun run dev        # or: npm run dev
```

Open http://localhost:3000. First-time visitors see the landing page; **Try the live demo**
seeds two weeks of sample history so you can explore instantly.

> The app is fully functional without any Firebase configuration — it just stays
> local-only, and sign-in buttons explain what's missing.

## Firebase setup (Google sign-in + Firestore sync)

Follow these steps once; they unlock **Sign in with Google** on the landing page and
per-user cloud sync. The same checklist lives in `.env.local.example`.

### 1. Create a Firebase project

Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
(analytics is optional).

### 2. Register a Web app and copy the config

Project settings (gear icon) → **Your apps** → **Web app** (`</>`) → register it, then copy
the `firebaseConfig` values.

Create your env file and paste them in:

```bash
cp .env.local.example .env.local
```

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

**Restart the dev server** afterwards — these variables are read at boot.

### 3. Enable Google sign-in and Email/Password

Firebase console → **Authentication** → **Sign-in method** → enable:

- **Google** — the one-tap button on the landing page.
- **Email/Password** — the "email & password" form ("Or sign in with email &
  password" on the landing). Practical for devices where Google refuses the
  account entirely, e.g. supervised child accounts (Family Link). Passwords
  need at least 6 characters; "Forgot password" sends a Firebase reset email
  to that address.

### 4. Add your domain to Authorized domains

**Authentication** → **Settings** → **Authorized domains** → add the exact origin you open
the app from (e.g. `localhost:3000` or your preview/deploy domain). If the domain is missing,
sign-in fails with a descriptive error that names the origin to add.

### 5. Create the Firestore database

**Firestore Database** → **Create database** (production or test mode both work — the rules
below are what actually govern access).

### 6. Publish the security rules

Copy [`firestore.rules`](./firestore.rules) into **Firestore Database → Rules** and click
**Publish** (or `firebase deploy --only firestore:rules` if you use the CLI). The rules grant
each signed-in user access to *only* their own tree:

```
users/{uid}              — profile doc (displayName, email, settings)
users/{uid}/tasks/{id}   — task blocks
users/{uid}/logs/{id}    — timer sessions & reflections
```

Everything else in the project is unreachable from clients.

### How sync behaves

- The Zustand store stays the local-first source of truth; a subscription pushes every
  change to Firestore (fire-and-forget, batched first upload of local-only docs).
- `onSnapshot` listeners apply remote changes back with last-write-wins resolution
  (`updatedAt` / `syncedAt` clocks).
- Firestore's persistent local cache (IndexedDB, multi-tab) queues writes made offline and
  replays them on reconnect.
- Failures degrade gracefully: worst case you lose cloud sync, never local functionality.

## Production build

```bash
bun run build
bun run start                          # serves .next/standalone via bun
# npm users: NODE_ENV=production node .next/standalone/server.js
```

## Deploy to Firebase Hosting (static, free tier)

The planner is 100% client-side (local-first store + Firebase JS SDK), so it deploys as a
**fully static site** — no server, no Blaze plan needed. `npm run build:static` runs a
static export that writes the site to `out/`.

### 1. `firebase init hosting` — the right answers

| Prompt | Answer |
| --- | --- |
| What do you want to use as your public directory? | **`out`** (not `public` — `public/` only holds icons/manifest; the app itself isn't there) |
| Configure as a single-page app (rewrite all urls to /index.html)? | **Yes** |
| Set up automatic builds with GitHub? | No (unless you want CI) |
| File `out/index.html` already exists. Overwrite? | **No** (only appears if you init after building) |

Already ran init with different answers? Just edit `firebase.json` — it should look like:

```json
{
  "hosting": {
    "public": "out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "/sw.js",
        "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
      },
      {
        "source": "/_next/**",
        "headers": [{ "key": "Cache-Control", "value": "max-age=31536000, immutable" }]
      }
    ]
  }
}
```

The `/sw.js` no-cache rule matters: the service worker must revalidate on every visit so
updates reach installed PWAs. `/_next/**` files are content-hashed, so immutable caching is
safe.

### 2. Build & deploy

```powershell
npm run build:static     # static export → ./out  (reads .env.local, bakes NEXT_PUBLIC_* in)
firebase deploy --only hosting
# or both in one go:
npm run deploy
```

### 3. After first deploy — allow sign-in on the new domain

Firebase console → **Authentication → Settings → Authorized domains** → add your hosting
domain (e.g. `your-project.web.app`). Google sign-in fails with `auth/unauthorized-domain`
until you do (see the Firebase setup section above for details).

> Alternative: **Firebase App Hosting** (`firebase init apphosting`) runs the full Next.js
> server (SSR + API routes) via Cloud Run — but it requires the Blaze plan and adds nothing
> for this app, since the planner never calls the server.

## Troubleshooting

**Sign-in bounces back to the landing page — especially a child's Google account (Family
Link, under-13)** — Google itself restricts **supervised child accounts**: it refuses
third-party sign-in until a parent approves the app, and often blocks it entirely. The
flow returns to the site **without a session**, so the app shows the landing page again.
From v12 the app explains what happened instead of failing silently: a red explanation
card appears right under the sign-in buttons (message + what to do + the raw Firebase
error code, when Google returns one), and the same explanation is shown if the account
is restricted, the browser blocks storage/cookies, or the redirect came back empty. The
card also has a *Use email instead* button that jumps straight to the email form. Your
options, in order of simplicity:

1. **Skip sign-in on the child's device** — tap *Continue without sign-in* on the error
   card (or *Try the live demo*). The app is local-first: plans, timers, logs and notes
   live in that browser's storage and work fully offline. This is usually all a child
   needs.
2. **Approve the app for the supervised account** in Google's Family Link / the child's
   account settings ("Third-party apps & access"), then sign in again. Availability is
   decided by Google, not by this app.
3. **Use an adult's Google account** on that device if you specifically want Firestore
   sync (data then follows that account across devices).
4. **Use email & password instead** — tap *Use email instead* on the error card (or
   *Or sign in with email & password* on the landing) and create an account (needs
   **Email/Password** enabled in Firebase Console →
   Authentication → Sign-in method). This path is handled entirely by your own Firebase
   project and is not affected by Family Link restrictions.

Also check the usual suspects if the card mentions them: the hosting domain must be in
**Firebase Console → Authentication → Settings → Authorized domains** (see the deploy
section below), and Google sign-in must be enabled as a provider.

**Dev server warns `Unknown at rule: @apply / @theme / @custom-variant / @utility` (and the
app renders unstyled)** — Tailwind's PostCSS plugin did not run, so the raw Tailwind v4
at-rules reached the bundler's CSS parser. Two independent causes, both easy to fix:

1. **`postcss.config.mjs` missing from the project root.** Builds before v9 never shipped
   it, and without it Tailwind v4 is not applied at all. Restore it (it ships in the v9+
   zip) — its entire content is:

   ```js
   const config = {
     plugins: ["@tailwindcss/postcss"],
   };

   export default config;
   ```

2. **Stale `.next` dev cache** — e.g. a `next build` ran while `next dev` was live, or the
   cache survived an interrupted session. Symptoms: dev serves raw at-rules even though
   `postcss.config.mjs` is present. `next build` output is unaffected (it always
   recompiles); only dev reuses the corrupted incremental state.

Either way the recovery is the same:

```powershell
# stop the dev server first (Ctrl+C), then:
Remove-Item -Recurse -Force .next     # clear stale dev cache
npm install                           # syncs node_modules with the shipped lockfile
npm run dev
```

Your tasks/logs/notes live in the **browser's** localStorage/IndexedDB — deleting `.next`
or `node_modules` never touches them.

**Animations are in-house, zero third-party packages** — all enter/exit transition
utilities (`animate-in/out`, `fade-*`, `zoom-*`, `slide-*`, accordion + caret-blink
keyframes) are implemented in `src/app/animations.css` using Tailwind v4 primitives only
(`@property`, `@theme`, `@utility`). The class names are identical to the ones shadcn/ui
components use, so components don't change. `Module not found: Can't resolve
'tw-animate-css'` can no longer occur in this project — if you ever see it, you are running
an older copy.

**`Module not found: Can't resolve '<some other package>'`** — `node_modules` is out of
sync with `package.json` (partial install or a *failed/partial* delete). Note that after a
partial delete npm may say `up to date` while files are physically missing, because it
trusts the hidden lockfile (`node_modules\.package-lock.json`) instead of the disk. Repair
in place (no deletion needed):

```powershell
# stop the dev server first (Ctrl+C in its terminal), then:
Remove-Item node_modules\.package-lock.json -Force   # OK if this errors "not found"
Remove-Item -Recurse -Force .next                    # clear stale build cache
npm install                                          # rescans disk, restores everything missing
npm run dev
```

If that still fails, do a full clean reset:

```powershell
# 1. stop the dev server (Ctrl+C), close VSCode, then kill leftover node processes:
taskkill /F /IM node.exe
# 2. delete (close VSCode first — its file watcher locks node_modules):
Remove-Item -Recurse -Force node_modules
#    still "being used by another process"? rename instead — rename usually works even
#    when delete is blocked; delete the folder after a reboot:
Rename-Item node_modules node_modules_old
# 3. reinstall fresh:
npm install
npm run dev
```

**npm `allow-scripts` warnings** (`@prisma/client`, `sharp`, `es5-ext`, …) — these packages
ship optional install scripts that npm now holds for approval. The app runs fine without
running them; approve later with `npm approve-scripts <pkg>` if you want native-speed
binaries (sharp/prisma engines) rebuilt locally.

**Do NOT run `npm audit fix --force`** — it force-bumps packages to new major versions and
can break the build. The audit findings live in dev tooling chains and don't block dev or
build.

## Notes

- **Single route** — the whole app lives at `/` (landing ⇄ app is a state gate, not
  routing), keeping the surface ready for a future Capacitor wrapper.
- **Sign-in is redirect-only** — Google sign-in always uses a full-page redirect; there are
  no popups anywhere in the app. Popups are blocked or break silently in installed PWAs,
  iOS Safari, and supervised (Family Link) browsers, while the redirect works in all of
  them and funnels every failure into one consistent explanation card.
- **Back to the start page** — a door icon sits on the Today header and a *Back to start*
  button on the Settings header; both always return to the landing page. Signed-out users
  (demo/local mode) leave directly — data stays on the device. Signed-in users confirm a
  sign-out first (cloud data is untouched; signing back in restores it).
- **Plan ahead** — every task has a day: *Today / Tomorrow / Pick a date / Any day* in the
  task form. Tasks planned for later days show under **Today → Coming up** and on their day
  in **Overview** (tap any calendar day → its plan + *Add a task for this day*). *Any day*
  keeps the pre-v14 behavior (task stays on Today's timeline until done) so existing plans
  never move.
- **Demo data** — Settings → Data can load a demo dataset or reset everything. Demo data
  is never seeded for signed-in users, so a fresh cloud account starts clean.
- **Prisma/SQLite** (`db/custom.db`, `prisma/schema.prisma`) is present for the legacy API
  route; the planner itself doesn't depend on it.
