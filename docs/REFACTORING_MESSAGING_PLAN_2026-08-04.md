# Messaging refactor plan

Date: 2026-08-04
Development branch: `refactor/messaging`
Baseline: `93919f092` (`origin/codespaces-review` at branch creation)
Recovery branch: `backup/messaging-pre-refactor`
Status: analysis complete; no messaging production refactor started

## Objective

Reduce messaging coupling without changing user-visible behavior, table/RPC
semantics, permissions, cache timing, Realtime ownership, scroll anchoring or
native lifecycle behavior. Work is performed in Codespaces and promoted only
through independently verified and revertible tranches.

The competition refactor is not an ancestor of this branch. Its completed state
remains protected separately by `backup/competition-phase1-complete` and the
six `verify/competition-*` branches.

## Current risk shape

- `MessagesPage.tsx`: 3,619 lines; inbox reads, enrichment, visibility, unread
  aggregation, cache hydration, prefetch and Realtime orchestration.
- `GroupChatPage.tsx`: 2,805 lines.
- `TeamChatPage.tsx`: 2,246 lines.
- `ClubChatPage.tsx`: 1,908 lines.
- `DirectMessagePage.tsx`: 1,702 lines.
- `ClubAdminChatPage.tsx`: 1,435 lines.
- `BroadcastChatPage.tsx`: 1,265 lines.
- `VirtualizedChatMessageList.tsx`: 2,391 lines of height estimation, prepend,
  jump, anchoring, keyboard and native-WebView behavior.

The principal risk is not rendering complexity alone. It is the interaction of
authorization, scope-specific tables, optimistic writes, cache reconciliation,
Realtime delivery, notification jumps, native resume and scroll stability.

## Existing refactoring gate

Existing protection already covers:

- team, club, group, direct, club-admin and broadcast send contracts;
- denied access and removed-member database isolation;
- cached, delayed, empty, failed and retrying thread loads;
- optimistic send, failure restoration and duplicate prevention;
- reaction optimism, rollback and Realtime reconciliation;
- Realtime insert/update/delete deduplication and teardown;
- older-history prepend and exact notification jumps;
- pinned messages, scheduled messages, reads and typing;
- offline cached rendering, queued send and reconnect recovery;
- Android/iOS-like resume, request saturation and keyboard/layout behavior;
- inbox reveal stability, ordering, unread counts and notification routing;
- local-Supabase messaging RLS and Realtime lifecycle.

Add characterization only where a proposed extraction exposes a demonstrated
gap. Do not grow tests merely to increase counts.

## Tranche sequence

### M1 — inbox pure read model

Extract typed, deterministic functions for conversation identity, preview
normalization, ordering, hidden/muted filtering and enrichment fallbacks.

Do not move queries, effects, cache writes, polling or Realtime ownership yet.

Required gates:

- existing stable-inbox, unread, preview, cache and surface-parity suites;
- partial enrichment failure preserves the conversation row;
- equal inputs preserve stable ordering and identity;
- Android/iOS Home and inbox no-jolt Playwright journeys.

### M2 — inbox repositories and query boundaries

Move explicit scope reads into typed repositories while preserving table names,
filters, RPCs, query keys, error propagation and request cadence. Keep one
repository function per semantic read; do not hide Supabase behind a generic
query builder.

Required gates:

- authorization and club/team isolation;
- partial-query failure remains distinguishable from a valid empty inbox;
- hidden/muted conversations remain hidden after refetch;
- bounded prefetch and scoped Realtime invalidation;
- complete inbox Playwright journeys.

### M3 — explicit scope adapters

Define typed adapters for team, club, group, direct, club-admin and broadcast
tables, identifiers, permissions and capabilities. Shared primitives may be
reused, but adapters remain explicit and reviewable.

Do not create a single page/component controlled by many boolean props.

Required gates:

- parameterized cross-surface read/send/edit/delete/reaction contracts;
- exact table and immutable scope identifiers;
- membership revocation and channel teardown;
- role/Pro capability differences for pins, schedules and attachments;
- local-Supabase messaging security journey.

### M4 — thread lifecycle primitives

Extract pagination, cache hydration, optimistic/server reconciliation, Realtime
event application, read reconciliation and teardown as small composable hooks.
Keep navigation-jump and visual-scroll ownership separate.

Required gates:

- cached/initial/failure/empty states;
- optimistic deduplication and retry;
- older-page boundary deduplication and anchor preservation;
- Realtime insert/update/delete/reaction behavior;
- offline/reconnect and Android/iOS resume journeys;
- no leaked channels, listeners or timers.

### M5 — composer and mutation controllers

Extract draft, reply, edit, send, attachment upload, scheduling and retry
orchestration. Preserve each scope adapter's authorization and payload shape.

Required gates:

- send button remains present and keyboard-safe;
- draft restoration and failed optimistic-send rollback;
- repeated taps create one write;
- exact reply/edit identity;
- attachment cleanup and retry;
- scheduled/pinned/Pro gates and all scope send Playwright journeys.

### M6 — page composition and presentation

Reduce each thread page to explicit scope adapter + lifecycle primitives + page
shell. Extract header/details/search/action presentation only after controllers
are independently green.

Required gates:

- complete messaging Playwright baseline on desktop, Android-like and iOS-like
  projects;
- cold/warm notification entry and exact old-message landing;
- club-admin delayed/empty/retry behavior;
- direct-message start and send affordances;
- full one-click baseline.

### M7 — virtualization internals, last and optional

Only proceed if the preceding tranches leave a clear maintainability problem.
Split measurement/estimation, prepend control, jump hydration and viewport
adapters without changing Virtuoso ownership or timing constants.

Required gates:

- row-height and mixed-content estimator tests;
- prepend anchor and no-jolt sampling;
- loaded and out-of-window notification jumps;
- keyboard/safe-area behavior;
- image/video/reaction late-height changes;
- repeated full Playwright runs to detect timing instability.

## Branch and promotion policy

For each completed messaging tranche:

1. create a cumulative `verify/messaging-XX-name` pointer;
2. run focused static, unit/component, Playwright and build gates in Codespaces;
3. manual Codespaces UI review may be deferred, but the tranche must then be
   marked **not promotable**;
4. after UI review, construct `promote/messaging-XX-name` from the latest
   `origin/main` and apply only that tranche;
5. verify the promotion diff in a disposable integration branch;
6. squash-merge one tranche into `main`;
7. merge the resulting `main` back into the integration baseline before
   constructing the next promotion branch.

Never merge `refactor/messaging` or a cumulative `verify/*` branch directly to
`main`.

## Stop conditions

Stop the current tranche if:

- a scope's table/RPC/filter semantics become implicit;
- authorization or entitlement moves from backend enforcement to UI trust;
- a cached, failed and authoritative-empty state can no longer be distinguished;
- Realtime ownership becomes shared by multiple uncoordinated hooks;
- scroll/jump timing changes without a dedicated behavior test;
- the change requires unrelated production fixes or schema migrations;
- focused or baseline tests fail for an unexplained reason.
