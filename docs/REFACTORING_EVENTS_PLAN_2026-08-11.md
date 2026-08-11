# Ignite Club HQ — Events refactoring plan

**Established:** 11 August 2026
**Development branch:** `codespaces-review`
**Starting checkpoint:** `74d6ec4d4`
**Status:** audit and first E0 characterization bundle complete; production refactoring not started

## E0 progress — 11 August 2026

Added and verified without changing production code:

- direct role-resolution coverage for club admin, committee member, team coach,
  mini-league manager, ordinary member, and app-admin override;
- sensitive read gating for targeted rosters, payments, and match-only markers;
- guardian/direct-child RSVP composition for targeted events, including
  out-of-scope filtering, deduplication, and adults-only events;
- create/edit payload parity for mini leagues, byes, arrival details, social
  payment/guest settings, grouping, multi-team targets, reminders, recurrence,
  duties, and aligned timestamps;
- training conflict-query characterization, including recurring parents;
- a standard-team Playwright journey covering form selection, transactional
  creation with duties, navigation, and correct team detail rendering.

Focused result: 48 Vitest checks and 8 Playwright journeys pass.

Still desirable before changing the corresponding high-risk slices:

- reminder-recipient policy extracted to a directly testable domain helper;
- one local-Supabase standard-team lifecycle/RLS scenario (the existing local
  lifecycle and club-wide journeys already cover much of the database path).

### Defect exposed by E0

The core event query correctly distinguishes loading, missing/inaccessible rows,
and exhausted transient fetch failures. The RSVP query does not retain or render
its error state: `EventDetailPage` destructures only `data`, so an RLS/network
failure is presented as empty attendance while RSVP controls remain active.
The new regression test intentionally remains red until this is corrected in
production and merged back through the normal workflow.

## Objective

Make event creation, editing, attendance and lifecycle management easier for a
vendor to understand and safely change while preserving permissions, RLS
expectations, RSVP ownership, recurring-series semantics, notification and chat
side effects, payments and PitchBoard entry.

The intended dependency direction is:

`page UI -> controller/hook -> workflow/read repository -> Supabase contract`

This is a structural programme, not a feature redesign. Implementation stays on
`codespaces-review` until focused and complete verification passes. Nothing is
promoted to `main` without manual review and explicit approval.

## Current shape

| Surface | Lines | Primary responsibilities |
| --- | ---: | --- |
| `EventDetailPage.tsx` | 4,427 | Event/RSPV/roster reads, permissions, payments, duties, attendance, cancellation, reminders, awards, sharing and PitchBoard entry |
| `CreateEventPage.tsx` | 1,810 | Scope selection, recurrence, time/duration, conflicts, targeting, duties and atomic creation |
| `EditEventPage.tsx` | 1,523 | Permission resolution, occurrence/series editing, targeting and atomic duty synchronization |
| `EventsPage.tsx` | 1,307 | Membership-derived read scope, online/offline schedule loading, filters, calendar/list presentation and cache recovery |

The largest risk is not line count alone. `EventDetailPage` combines many
independent business transactions and several overlapping interpretations of
event membership, manager access and attendance audience.

## Existing protection

The current baseline already provides strong coverage for:

- personal and child RSVP create/update failure semantics;
- admin RSVP RPC boundaries;
- event deletion confirmation and cache behavior;
- single and recurring cancellation, including partial commits;
- payment checkout, callback verification, retry and listener cleanup;
- duty creation, claim, assignment, completion and failure reporting;
- reminder cooldown, recipient deduplication and invite resend ordering;
- club-wide grade/team grouping and multi-team targeting;
- create-event scope validation and atomic `create_event_with_duties` usage;
- edit-series atomic RPC and atomic duty synchronization;
- cross-club RLS, targeted-event visibility and RSVP revocation;
- Android/iOS PitchBoard restoration and event entry through the wider baseline.

At the starting checkpoint, the complete baseline passes 4,553 frontend tests,
138 isolated Playwright journeys and 258 isolated local-Supabase integration
tests. Three dependency-monitoring tests are intentionally skipped.

## Material E0 gaps

Only gaps needed to make the planned extractions safe should be added. Do not
create broad snapshots or duplicate backend RLS tests in component mocks.

Ranked by refactoring risk:

1. **Event detail read-model failure and isolation.** Directly characterize the
   event, RSVP, guest, duty and payment query boundaries so errors cannot become
   false empty states and unrelated event rows cannot enter the model.
2. **Manager capability matrix.** Characterize app admin, club admin,
   committee, team admin/coach, league admin, Subs Manager and ordinary member
   permissions for edit, cancellation, attendance management, reminders,
   payments and PitchBoard access.
3. **Targeted attendance composition.** Protect multi-team adult/child roster
   merging, shared guardians, duplicate roles, unknown children and grouping by
   grade versus team.
4. **Create payload matrix.** Assert exact atomic RPC payloads for team events,
   whole-club events, targeted multi-team games, mini-leagues and recurring
   events, including duties and RSVP audience fields.
5. **Edit payload matrix.** Assert exact occurrence versus series payloads,
   target-team/grouping changes, scope validation and duty synchronization.
6. **Conflict checking.** Protect team, venue and recurrence conflict queries,
   override behavior, query failure behavior and repeated-submit suppression.
7. **Reminder recipient policy.** Directly protect individual child guardian
   fan-out, shared-guardian deduplication, target-team boundaries and cooldown
   behavior without testing provider internals.
8. **RSVP ownership matrix.** Complete the existing coverage for a second
   guardian updating an existing child RSVP, offline queue fallback and
   mini-league player ownership.
9. **Schedule read scope and offline recovery.** Characterize membership-derived
   team/club/league scope, event visibility filters, cached fallback and
   fail-closed behavior when membership reads fail.
10. **One complete standard-team journey.** Add one durable Playwright journey
    covering create, edit, RSVP, attendance and cancel for a normal team event;
    the existing comprehensive journey is specialized to club-wide games.

Payment, deletion and base duty tests are already sufficiently strong. Add no
more tests there unless an extraction exposes a genuinely unprotected branch.

## Staged refactoring

### E0 — Characterization gate

- Add the ten material contracts above using pure/unit tests for policy,
  component characterization for query/mutation composition, one Playwright
  journey for the complete normal-team flow, and local Supabase only where
  backend enforcement is the behavior under test.
- Run the focused event estate and classify every failure as production defect,
  harness defect or inaccurate expectation before changing behavior.
- Do not refactor production code in this stage except a minimal export that is
  essential for non-brittle testing and preserves runtime behavior.

### E1 — Shared event domain and capability policy

- Extract typed event scope, audience, recurrence and capability decisions.
- Consolidate manager/action availability without moving backend authorization
  into the frontend.
- Keep public page behavior, labels and route contracts unchanged.

Gate: capability matrix, scope validation, entitlement and local RLS suites.

### E2 — Event read repositories

- Extract event detail, RSVP, guest, duty, payment, award and scoped-roster
  reads into feature-local repositories with explicit query failure behavior.
- Extract schedule membership/scope resolution and event-list reads separately.
- Centralize only event-owned query keys; do not perform an app-wide cache-key
  migration.

Gate: read isolation, error propagation, offline schedule and targeted-roster
tests.

### E3 — Create and edit workflows

- Extract form-to-payload mapping, recurrence generation and conflict policy as
  pure functions.
- Extract atomic create, occurrence edit, series edit and duty-sync workflows.
- Preserve the existing RPC names, argument shapes, retry behavior and
  double-submit guards.

Gate: create/edit payload matrices, series transaction, duty transaction,
scope validation and club-wide Playwright coverage.

### E4 — RSVP and attendance orchestration

- Extract personal, child, admin and mini-league RSVP workflows behind explicit
  ownership inputs.
- Extract targeted roster composition and attendance grouping.
- Preserve offline queuing, points, cache invalidation and guardian semantics.

Gate: RSVP matrix, guardian integrity, attendance components and local event
lifecycle journeys.

### E5 — Event lifecycle side effects

- Extract duties, cancellation, reminder/resend and payment coordinators as
  separate workflows. Do not combine them in one service.
- Retain explicit partial-commit results where a database mutation succeeds but
  a best-effort notification or chat post fails.
- Do not alter Edge Functions, schema, RLS or provider contracts in this
  structural tranche.

Gate: existing Event Detail characterization, payment, notification fan-out,
duty and cancellation suites.

### E6 — Page composition and presentation

- Split cohesive sections only after their policy and workflows are outside the
  page: header/actions, attendance, duties, payments, reminders and game tools.
- Keep loading, error, empty and permission-denied states explicit.
- Avoid a generic mega-context or prop object that merely moves complexity.

Gate: focused component tests, accessibility assertions and affected
Playwright journeys.

### E7 — Closeout

- Run focused event tests, TypeScript, targeted lint and production build.
- Run the full one-click baseline against the isolated local stack.
- Record final line counts, remaining risks and known legacy lint debt.
- Perform manual Codespaces UI review of normal team, club-wide, targeted,
  recurring and mini-league events on desktop and mobile-like viewports.
- Promote only after explicit approval; keep rollback possible per slice.

## Slice and rollback policy

- One independently reviewable commit per boundary.
- Never mix a discovered production defect into a refactoring commit.
- Before each slice, record exact public contracts and run its focused tests.
- After each slice, inspect Supabase tables/RPCs, filters, query keys,
  invalidations, permissions and user-visible failure messages for drift.
- Revert the individual slice if behavior differs; do not weaken a test to make
  an accidental change pass.

## Explicit non-goals

- no UI redesign;
- no event feature changes;
- no schema, migration, RLS or Edge Function changes;
- no payment-provider or notification-provider changes;
- no recurrence algorithm redesign;
- no global repository abstraction;
- no mass TypeScript or lint cleanup;
- no snapshot tests used as a substitute for behavioral assertions.

## Stop conditions

Pause the tranche if a slice:

- changes who can see or manage an event;
- changes RSVP ownership or guardian behavior;
- changes target-team, role-audience or club/team scope;
- changes recurrence or cancellation cardinality;
- changes notification, chat, payment or duty delivery guarantees;
- requires a backend contract change;
- produces an unexplained focused or baseline failure;
- cannot be independently reviewed and reverted.

## Recommended immediate action

Implement E0 as a bundled but test-only stage, starting with event-detail read
isolation and the capability matrix. Review any genuine defect before fixing
it. Begin E1 only after E0 is green.
