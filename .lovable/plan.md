## Goal

After the app has been backgrounded on Android for a while, Schedule and Media come back stuck on skeletons until a force-quit. Fix the underlying cause (requests that were in flight at suspend never finish, never time out, and block the queries that gate those screens) rather than adding more refetches on top.

## Root cause recap

1. `src/lib/supabaseAuthRetry.ts` aborts PostgREST GETs with `setTimeout`. Android freezes timers while backgrounded, so the abort never fires. The socket is dead but the promise stays pending forever.
2. `EventsPage` will not run its events query until `user-memberships-for-events` resolves. `MediaPage` shows skeletons while `loadingProAccess` is true, and that query starts with `ensureFreshSession()`, whose 12s guard only applies when the document is visible — started while hidden, it can hang indefinitely.
3. A permanently pending fetch also holds one of the browser's ~6 connections per origin, so other screens degrade too.

## Changes

### 1. Wall-clock deadline for PostgREST GETs (`src/lib/supabaseAuthRetry.ts`)

Replace the timer-only abort with a deadline based on `Date.now()`:

- Record `deadlineAt = Date.now() + REST_GET_TIMEOUT_MS` and register the controller in a module-level set of in-flight GETs.
- Keep the `setTimeout` for the normal foreground case, but also sweep the set on a short interval and on every resume signal, aborting any entry whose `deadlineAt` has passed by wall clock. This catches requests whose timer was frozen.
- Remove entries in a `finally` so the set never leaks.
- Export `abortStaleRestGets(reason)` plus `abortAllInFlightRestGets(reason)` for the resume path.

### 2. Abort-and-reissue on resume (`src/lib/reactQueryNativeAdapter.ts`)

On `appStateChange` → active and on `visibilitychange` → visible, if the app was hidden for more than a threshold (about 20s):

- Call `abortAllInFlightRestGets("resume")` first, so dead sockets are released before anything refetches.
- Then run the existing staggered recovery refetch. Aborted queries surface as errors and are picked up by that pass.

Order matters: abort, then refetch. Today only the refetch happens and it queues behind the zombies.

### 3. Escape hatch on the two gating queries

- `src/pages/EventsPage.tsx`: the events query must not depend on `membershipsLoading` alone. Treat memberships as "resolved-or-timed-out": if it has not settled within a few seconds, fall back to the last known memberships (React Query cache / `placeholderData`) and let the events query run rather than hold the screen. Keep the retry so a real result still lands and re-renders.
- `src/pages/MediaPage.tsx`: `showSkeletons` should not be driven by `loadingProAccess` forever. Bound the pro-access gate with the same resolved-or-timed-out treatment used by the existing `proAccessEverResolved` ref, so photos render from cache while pro state is still settling.

### 4. `ensureFreshSession` bound unconditionally (`src/lib/ensureFreshSession.ts`)

Apply the 12s race whether or not the document is visible. The visibility condition is exactly what lets a background-started refresh hang. On timeout, keep the current behaviour (return the existing session id and let the interceptor retry).

### 5. Remove redundant visibility listeners

`MediaPage` has two `visibilitychange` listeners (cache hydrate at ~line 201, comments/reactions invalidate at ~line 951). Give them the same native early-return already applied to `MessagesPage`, so the adapter's recovery drip is the single source of resume refetching on native. Web behaviour is unchanged.

### 6. Tests

Add a guard test alongside `src/test/androidInboxResume.guard.test.ts`:

- Stale GETs are aborted when wall-clock time has advanced past the deadline even with timers frozen.
- Resume aborts in-flight GETs before triggering recovery refetch.
- `ensureFreshSession` resolves within the bound when hidden.
- Native early-return holds for the Media listeners.

## Technical notes

- No database, RLS, or edge-function changes. This is entirely client-side lifecycle work.
- Only PostgREST GETs are aborted. Writes, RPCs, storage uploads, and edge-function calls are untouched, so no risk of duplicated side effects.
- The abort registry is module-level and shared, so the fix benefits every screen, not just Schedule and Media.
- Verification: after implementing, run the test suite and check the resume path in preview. Real confirmation needs an Android device left idle for several minutes.
