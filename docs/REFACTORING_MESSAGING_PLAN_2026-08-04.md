# Messaging refactor plan

Date: 2026-08-04
Development branch: `refactor/messaging`
Baseline: `93919f092` (`origin/codespaces-review` at branch creation)
Recovery branch: `backup/messaging-pre-refactor`
Status: M1, M2 and M3 technically complete locally; M4a query-envelope normalization and M4b query-message ordering complete; manual UI review deferred

## Progress

- M1a extracted persisted filter normalization, type-bucket filtering,
  unread/recent partitioning, activity ordering and stale operational-chat
  disclosure into a typed pure inbox model.
- `MessagesPage` retains all conversation construction, queries, cache writes,
  polling, Realtime subscriptions and presentation ownership.
- M1a verification: TypeScript and extracted-module lint passed; 160 broader
  inbox/messaging tests and three Android/iOS-like no-jolt Playwright journeys
  passed; the production build completed successfully.
- Whole-file `MessagesPage` lint remains blocked by pre-existing legacy `any`,
  empty-block and hook-dependency debt. M1a did not add or expand that debt.
- M1b extracted active mute classification and hidden-conversation resurfacing
  rules without moving their Supabase queries, query keys, mutations or cache
  behavior. It covers mute expiry boundaries and scope separation, plus hidden
  DM/personal-group behavior with no message, equal timestamps, newer messages
  and active search.
- M1b verification: extracted-module lint and TypeScript passed; 160 broader
  inbox/messaging tests and the three native-like no-jolt Playwright journeys
  passed; the production build completed with established warnings only.
- M1c extracted canonical scope identity/routes, group unread precedence,
  provisional-versus-definitive Pro entitlement fallback and draft activity
  enrichment. Source-specific preview construction remains in `MessagesPage`
  for the next M1 slice.
- M1c verification: 166 broader inbox/messaging tests, extracted-module lint,
  TypeScript and three native-like no-jolt Playwright journeys passed; the
  production build completed with established warnings only.
- M1d extracted typed source-specific row and preview builders for broadcast,
  club, team, league/group, direct, club-admin and support conversations. All
  source queries, filters, authorization, cache stabilization and Realtime
  ownership remain in `MessagesPage`.
- M1d verification: 174 broader inbox/messaging tests, extracted-module lint,
  TypeScript and three native-like no-jolt Playwright journeys passed; the
  production build completed with established warnings only. A focused test
  also locks the partial-enrichment contract: authorized rows remain visible
  when their latest-message preview is unavailable.
- M2a extracted explicit repositories for app-admin capability, per-club Pro
  entitlement and competition-to-club scope membership. React Query keys,
  options, cadence and placeholder behavior are unchanged. Repository tests
  lock exact tables, columns, filters, empty-scope short circuits, expiry
  boundaries, deduplication and backend-error propagation.
- M2a verification: 180 broader inbox/messaging tests, repository/module lint,
  TypeScript and three native-like no-jolt Playwright journeys passed; the
  production build completed with established warnings only.
- M2 inventory identified pre-existing failure ambiguity in several legacy
  reads, including muted/hidden preferences and parts of admin-club/latest-
  message enrichment. Those reads were deliberately not moved or changed in
  M2a; each needs characterization and a separate behavior decision before its
  repository extraction.
- M2b characterization reproduced three existing failures: errors reading
  `chat_mute_preferences`, `hidden_dm_conversations` and
  `hidden_chat_groups` resolved as successful empty results. The narrow fix now
  propagates each backend error so React Query can retain prior successful
  preference data rather than publishing false empty state.
- M2b verification: all 11 repository tests pass, including the three former
  failure contracts and valid user-scoped success paths; 185 broader inbox and
  messaging tests, TypeScript, focused lint, production build and three
  native-like no-jolt Playwright journeys also passed.
- M2c extracted admin-team, committee-member and complete user-role reads. It
  fixes three pre-existing fail-closed availability defects where transient
  backend errors were published as empty/false capability data, temporarily
  hiding group creation or role-gated conversations. Query keys, role filters,
  cache options and UI authorization remain unchanged.
- M2c verification: all 15 repository tests and 189 broader inbox/messaging
  tests passed with TypeScript, focused lint and production build. Both Android
  journeys passed first run; the iOS-like journey passed on isolated rerun after
  one unrelated synthetic Capacitor initialization failure.
- M2d extracted the multi-step user-to-mini-league membership read. It retains
  primary-parent and additional-guardian union semantics, deduplicates shared
  children and league ids, skips assignment reads when no children exist, and
  now propagates failures from all three tables instead of publishing empty
  membership.
- M2d verification: all 20 repository tests, 194 broader inbox/messaging tests,
  TypeScript, focused lint, production build and all three native-like no-jolt
  Playwright journeys passed.
- M2e extracted the active-club filter repository spanning personal-group
  membership and DM-peer club roles. It preserves raw per-group membership,
  excludes the current user from the role-check union, deduplicates DM/group
  peers, supports either source independently and avoids empty-scope queries.
  Failures from either table now propagate instead of publishing a false empty
  club scope.
- M2e verification: all 25 repository tests, 199 broader inbox/messaging tests,
  TypeScript, focused lint, production build and all three native-like no-jolt
  Playwright journeys passed.
- M2f extracted the event-title, vault-folder-name and vault-file-name reads
  used to enrich inbox link previews. Each repository retains its exact table,
  selected columns and id filter, normalizes identifiers for lookup, omits
  incomplete rows, avoids empty-scope requests and keeps backend failures
  distinct from valid empty metadata.
- M2f verification: all 31 repository tests, 113 selected inbox regression
  tests, TypeScript, focused lint, production build and all three native-like
  no-jolt Playwright journeys passed.
- M2g extracted the current user's administered-clubs read while preserving the
  exact `club_admin` role constraint and active non-shell club filters. It keeps
  the second query absent when no valid club ids exist and fixes a pre-existing
  ambiguity where a failed clubs read was published like an empty result.
- M2g verification: all 35 repository tests, 117 selected inbox regression
  tests, TypeScript, focused lint, production build and all three native-like
  no-jolt Playwright journeys passed.
- M2h extracted the inbox-wide Pro entitlement read. It retains direct club
  roles, parent-club inheritance from team roles, club-first short-circuiting,
  team-level fallback, Pro Football/admin overrides and strict expiry behavior.
  All four backend reads now propagate failures rather than temporarily
  publishing a false entitlement. The pure entitlement resolver moved from the
  React hook module into `lib` and remains re-exported for compatibility,
  preserving one shared rule without reversing repository-to-hook dependencies.
- M2h verification: all 43 repository tests and 9 shared entitlement tests, 134
  selected inbox/entitlement regressions, TypeScript, focused lint, production
  build and all three native-like no-jolt Playwright journeys passed.
- M3a introduced six explicit scope identity adapters for team, club, group,
  direct, club-admin and broadcast chat. They lock each message table, immutable
  scope column, reaction foreign key, cache prefix and route without merging
  page-specific permissions or capabilities. Shared history search now consumes
  the adapter reaction key instead of maintaining a second table map.
- M3a verification: 101 adapter, history, navigation and six-surface contract
  tests passed with TypeScript, new-module lint, production build and all seven
  relevant history/notification Playwright journeys across the combined runs.
  The history journey's readiness assertion was hardened from a generic
  five-second text lookup to the exact heading with a realistic cold-build
  allowance after two artifacts showed correct late rendering.
- M3b added explicit per-surface read/send policy boundaries and capability
  modes for attachments, vault selection, polls, scheduling, pins, forwarding,
  gallery publishing and club-announcement rows. Conditional behavior remains
  owned by each page (including support-DM restrictions, group settings and
  entitlement checks), and the contract explicitly does not replace database
  RLS as the authoritative authorization layer.
- M3b verification: 14 adapter tests, 6 source-backed capability parity tests,
  47 six-surface orchestration contracts, 3 policy parity guards and the
  relevant shared-history tests passed. TypeScript, new-module lint, production
  build and six selected cross-surface Playwright send/authorization journeys
  also passed. Team's exact send scope remains covered by the established
  optimistic-send journey.
- M3c began adapter consumption with the global broadcast surface. All React
  Query reads, invalidations, optimistic writes, rollback and watchdog inputs
  now share the adapter-derived cache key, and history search uses the adapter
  message table. Supabase reads/writes, Realtime table registration,
  app-admin authorization, payloads and timing remain unchanged and explicit.
- M3c broadcast verification: 96 adapter, history, navigation and page-contract
  tests, TypeScript, focused adapter lint, production build and both broadcast
  Playwright read/send authorization journeys passed.
- M3c club-admin consumption now derives its conversation-scoped React Query
  key and history-search table/filter from the adapter. Fetch, notification
  refresh, bounded recovery, watchdog, reaction reconciliation, optimistic
  mutation state, channel cleanup and visibility refresh all retain one cache
  identity. Supabase and Realtime table/filter literals remain explicit.
- M3c club-admin verification: 120 focused adapter, history, navigation,
  metadata and recovery tests, TypeScript, focused adapter lint, production
  build and all 8 club-admin Playwright non-blank/delayed/recovery/cache/error/
  empty/send journeys passed. One source assertion was updated because it
  intentionally required the removed cache-key literal; no runtime defect was
  found.
- M3c direct-message consumption now derives every conversation message cache
  key and history-search table/filter from the adapter. Notification refresh,
  mount and empty-state recovery, watchdog inputs, reaction reconciliation,
  manual/visibility refresh, optimistic send/error handling and Realtime cache
  writes retain one cache identity. Supabase reads/writes, Realtime filters,
  participant/Pro checks and support-conversation restrictions remain explicit
  and unchanged.
- M3c direct-message verification: 121 focused adapter, history, navigation,
  metadata and thread-state tests, TypeScript, production build and 5 focused
  Playwright permission/send/mobile-layout/notification-routing journeys
  passed. Whole-page lint continues to report pre-existing legacy type and hook
  debt; the newly touched dependency closures are declared. No runtime defect
  was found.
- M3c group consumption now derives all group-message React Query cache keys
  and history-search table/filter identity from the adapter. Fetch, notification
  recovery, watchdog, polling, Realtime reconciliation, anchored pagination,
  optimistic send/delete/reaction rollback and visibility refresh retain one
  cache identity. Group membership/RLS, settings, attachment/forwarding/gallery
  rules, Supabase mutations and Realtime filters remain unchanged.
- M3c group verification: 122 focused adapter, history, navigation, metadata and
  thread-state tests, TypeScript, production build and 4 focused Playwright
  send/reaction-success/reaction-rollback/notification-routing journeys passed.
  Whole-page lint retains pre-existing legacy type and hook debt; no runtime
  defect was found.
- M3c club consumption now derives all club-message React Query cache keys and
  history-search table/filter identity from the adapter. Fetch, notification
  recovery, watchdog, polling, Realtime reconciliation, anchored pagination,
  optimistic send rollback and visibility refresh retain one cache identity.
  Club membership/RLS, Club Pro gating, announcements, Supabase mutations and
  Realtime filters remain unchanged.
- M3c club verification: 123 focused adapter, history, navigation, metadata and
  thread-state tests, TypeScript, production build and 2 focused Playwright
  exact-scope-send/notification-routing journeys passed. Whole-page lint retains
  pre-existing legacy type and hook debt; no runtime defect was found.
- M3c team consumption now derives all team-message React Query cache keys and
  history-search table/filter identity from the adapter. Fetch, notification
  recovery, watchdog, polling, Realtime reconciliation, anchored pagination,
  member-management refreshes, optimistic send rollback and visibility refresh
  retain one cache identity. Team membership/RLS, announcements, attachments,
  gallery publication, Supabase mutations and Realtime filters remain unchanged.
- M3c team verification: 124 focused adapter, history, navigation, metadata and
  thread-state tests, TypeScript, production build and 6 focused Playwright
  attachment-success/attachment-rollback/optimistic-send/send-rollback/reply/
  notification-routing journeys passed. Whole-page lint retains pre-existing
  legacy type and hook debt; no runtime defect was found. Adapter consumption is
  now complete across all six messaging surfaces.
- M3 completion review ran the complete default Vitest suite successfully,
  rebuilt the production application, and ran the full 78-case messaging
  Playwright pack. The pack finished 76/78 on the combined run; both exceptions
  passed immediately in isolated reruns. The first was a cold-load DM denial
  timeout whose screenshot remained on the application spinner, and the second
  was an interrupted iOS-like frame reload in an unrelated pitchboard journey.
  The cumulative source diff confirms that Supabase operations, mutation
  payloads, authorization rules, Realtime tables/filters and timing constants
  were not changed. M3 is technically ready for deferred manual UI review.
- M4a begins thread lifecycle extraction with one pure query-data boundary that
  interprets the retained legacy array and `{ messages }` envelope shapes. It
  initially serves Broadcast and Direct Message only. Fetching, sorting,
  reconciliation, cache writes, loading states, navigation and Realtime remain
  page-owned; the remaining surfaces will migrate only after this slice passes.
- M4a initial verification: 7 pure query-data tests, 2 source-consumption
  contracts and 99 related adapter/reconciliation/load-state/page contracts
  passed (108 total), with TypeScript, focused lint and production build. Four
  Playwright journeys covering denied DM access, exact DM sending, authorized
  broadcast sending and read-only broadcast access also passed. No runtime
  defect was found.
- M4a now serves Team, Club, Group and Club Admin as well, completing the pure
  query-data boundary across all six surfaces. Envelope-only pagination,
  reaction and recovery metadata deliberately remains page-owned. Extension
  verification passed 112 focused tests, TypeScript, focused lint, production
  build and 6 Playwright exact-scope/delayed-hydration/reaction/optimistic-send
  journeys. One over-broad source assertion was narrowed because Team still
  legitimately reads pagination metadata; this was a test issue, not a runtime
  defect.
- M4b extracted the exact chronological query-message ordering rule shared by
  all six chat surfaces. It retains the existing timestamp comparison,
  deterministic immutable-id tie-break and non-mutating copy before the
  existing Realtime reconciliation step. Pagination merges, cache writes,
  Realtime handlers, search ordering and visual-scroll ownership remain in
  their pages.
- M4b verification passed 122 focused ordering, adapter, reconciliation,
  load-state and page contracts, TypeScript and focused lint. Eleven selected
  Playwright journeys passed across Broadcast, Direct, Club, Group, Club Admin
  and Team/Realtime behavior; one inbox-preview assertion exceeded its existing
  three-second timeout in the combined run and passed immediately in isolation.
  The failure occurred before thread navigation and did not execute the new
  ordering boundary. No runtime defect was found.

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
