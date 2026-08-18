# Cumulative refactoring promotion tranches — 17 August 2026

**Source evidence:** [`RELEASE_CANDIDATE_2026-08-17.md`](RELEASE_CANDIDATE_2026-08-17.md)

**Source branch:** `integrate/competition-current`

**Source tested commit:** `bca406b0c`

**Target:** fresh review branches created from then-current `origin/main`

## Non-negotiable rules

1. Do not merge the cumulative source branch directly into `main` or `prod`.
2. Before constructing each tranche, fetch and create a fresh branch from the
   current `origin/main`.
3. Select changes by intended behaviour and domain, not by blindly cherry-picking
   merge commits. Historical main merges and later fixes make bulk cherry-picks
   unsafe.
4. Include a domain's tests in the same tranche as its production behaviour.
5. Include a required migration or Edge Function in the first tranche whose
   frontend depends on it. Backend changes deploy before their dependent UI.
6. Rerun focused verification for every tranche and the complete isolated
   baseline on every cumulative candidate.
7. Stop after each tranche for review. A failure is investigated before another
   tranche is added.
8. Record the exact accepted SHA and rollback point at every gate.

## Construction order

> Superseding dependency detail: use
> [`PROMOTION_DEPENDENCY_MANIFEST_2026-08-18.md`](PROMOTION_DEPENDENCY_MANIFEST_2026-08-18.md)
> for exact ownership exceptions and cumulative order. In particular, Events
> must precede PitchBoard, and Messaging must precede Vault/Media integration.

### Tranche 00 — Test and release governance

Purpose: establish the non-production test harness and review controls before
moving application behaviour.

Primary scope:

- `src/**/*.test.ts`, `src/**/*.test.tsx`
- `tests/`, `e2e-baseline/`
- `local-supabase-workspace/`
- baseline Vitest/Playwright configuration
- local test orchestration and migration guard scripts
- test and promotion documentation
- CI workflow changes that do not deploy application code

Exclude production hooks, pages, migrations and Edge Functions unless a test
cannot compile without a small, separately reviewed contract extraction.

Gate: TypeScript, ESLint, frontend tests, Playwright, local Supabase, and cleanup.

### Tranche 01 — Competition fixtures and ladders

Primary scope:

- `src/features/competitions/`
- competition fixture/ladder components and route composition
- competition-only query keys, repositories and tests
- competition-specific migrations/Edge Functions required by the tranche

Reference checkpoints: `verify/competition-01-foundation` through
`verify/competition-06-composition`.

Gate: competition focused suites, role/tenant isolation, result mutation,
fixture generation, ladder behaviour, TypeScript/build, then full baseline.

### Tranche 02 — Messaging, inbox and notification navigation

Primary scope:

- `src/features/messaging/`
- chat scope adapters, query envelopes, cache hydration and reconciliation
- inbox construction/filter/reveal policies
- chat composer boundaries and virtualized-list integration
- message notification routing and scoped Realtime lifecycle
- messaging-specific backend parity required for those paths

Reference checkpoints: `verify/messaging-01a-*` through
`verify/messaging-10-complete`.

Gate: every chat type, cross-thread/club isolation, offline/reconnect, old-message
jump, notification navigation, reactions, drafts, failed sends, Android/iOS-like
resume journeys, RLS and Realtime integration, then full baseline.

### Tranche 03 — Authentication, membership and invitations

Primary scope:

- `src/features/membership/`
- invite signup/deep-link and active-club handoff
- club/team role mutation boundaries
- child, guardian and season-rollover workflows
- parent-invite provisioning migrations and exact local parity

Gate: auth recovery, all invite roles, atomic parent child provisioning,
duplicate-child prevention, guardian independence, role isolation, RSVP access,
concurrency/idempotency, then full baseline.

### Tranche 04 — Vault and Media

Primary scope:

- `src/features/vault/`, Vault route composition and storage helpers
- `src/features/media/`, Media route composition and signed URL helpers
- quota reservation, mutation reporting, deletion and feed/Vault separation
- required Storage/RLS/Edge contracts

Gate: role visibility, private URL fail-closed behaviour, upload compensation,
trash/permanent delete, Feed versus Feed-and-Vault deletion, offline/resume,
Storage RLS, then full baseline.

### Tranche 05 — PitchBoard, timer and AutoSub

Primary scope:

- `src/components/pitch/`
- active-game and timer hooks/services
- AutoSub planner, fairness, execution, notification-recipient isolation
- mini-league pitch orchestration
- required timer concurrency migration/Edge contract

Gate: timer lock/resume, stale writes, manual substitutions, formations, fill-ins,
halftime/fulltime, standard and equal-time modes, goalkeeper constraints,
notification recipients, mini-leagues and cross-device concurrency, then full
baseline.

### Tranche 06 — Events and Home read models

Primary scope:

- `src/features/events/`
- event create/edit/cancel/delete and attendance composition
- club-wide targeted events and grouping
- Home Next Up, RSVP, rewards and entitlement boundaries
- required event notification and recipient backend contracts

Gate: create/edit/cancel/delete, recurring series, duties, payments, targeted
audiences, grade/team grouping, notification fan-out, truthful cache completion,
Next Up freshness and local RLS journeys, then full baseline.

### Tranche 07 — Team, club, administration and remaining shared boundaries

Primary scope:

- team/club detail composition not already included above
- club setup, lifecycle and read-model isolation
- shared permissions, entitlements, cache/session lifecycle and navigation guards
- dependency/security upgrades and cross-cutting Edge changes not safely owned by
  an earlier tranche

This is not a catch-all approval. Split it further if its review diff is large
or combines unrelated behaviours.

Gate: role matrix, tenant isolation, team deletion/recreation, archived-team
selectors, club lifecycle, Pro/free transitions, dependency-specific regression
tests and full baseline.

## Per-tranche rollback record

Complete this table as each tranche is constructed. Blank entries mean the
tranche is not approved.

| Tranche | Fresh branch | Base `main` SHA | Candidate SHA | Automated evidence | Human reviewer | Accepted merge SHA | Rollback SHA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00 governance/tests |  |  |  |  |  |  |  |
| 01 competition |  |  |  |  |  |  |  |
| 02 messaging |  |  |  |  |  |  |  |
| 03 auth/membership |  |  |  |  |  |  |  |
| 04 vault/media |  |  |  |  |  |  |  |
| 05 pitch/autosub |  |  |  |  |  |  |  |
| 06 events/home |  |  |  |  |  |  |  |
| 07 remaining shared |  |  |  |  |  |  |  |

## Rollback method

- Frontend-only tranche: redeploy or revert to the recorded rollback SHA.
- Edge Function tranche: redeploy the function source from the rollback SHA;
  verify its schema compatibility first.
- Migration tranche: do not reverse historical migrations or improvise a down
  migration. Use a reviewed forward repair. Restore only under the documented
  recovery procedure and a confirmed recovery point.
- Native release: halt staged rollout or ship a reviewed corrective build; a Git
  revert does not remove an already installed native binary.

## Minimum human acceptance

If a full 30–45 minute review is unavailable, do not claim full acceptance. At
minimum, delegate these release-blocking checks against the exact candidate:

1. Sign in/out, switch between two clubs, and confirm no cross-club content.
2. Open and send in team, club, group, DM and club-admin chat; test one push or
   in-app notification to an old message.
3. Create/edit/delete an event and RSVP as an adult and guardian.
4. Upload/delete one private Vault file and one Media item.
5. Start PitchBoard, perform manual and automatic substitution, lock/resume.
6. Complete one Android and one iOS lifecycle/deep-link smoke check.

Record exceptions explicitly. Automated WebView-like journeys reduce risk but
do not replace physical-device or provider checks.
