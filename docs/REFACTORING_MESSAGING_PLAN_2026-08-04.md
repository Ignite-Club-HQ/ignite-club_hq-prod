# Messaging refactor plan

Date: 2026-08-04
Development branch: `refactor/messaging`
Baseline: `93919f092` (`origin/codespaces-review` at branch creation)
Recovery branch: `backup/messaging-pre-refactor`
Status: M1–M10 complete on the cumulative integration branch; automated closeout passed; delegated manual/native acceptance and promotion pending. See `REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`.

## 2026-08-07 messaging closeout

- The planned messaging refactor is complete through M10. Further extraction
  of page-owned hide/delete mutations or scoped Realtime lifecycles is a new,
  higher-risk tranche and is not recommended without a concrete feature or
  defect requiring it.
- Notification/deep-link hydration now has bounded reveal lifecycles. Tests
  prove that loaded messages remain masked until visual settling completes,
  newer jumps cancel stale reveals, the mask survives its full fade, and the
  seven-second deadline is used only as an emergency blank-screen escape.
- The complete frontend estate passed 3,957 tests across 343 files, with three
  intentional dependency-monitoring skips.
- The full Playwright estate completed 114/115 in the combined run. The sole
  failure was a WebKit internal `page.reload` error in an iOS pitchboard test;
  the unchanged journey then passed 3/3 in isolation. All messaging journeys,
  including Android/iOS settled exact-message reveal, passed in the full run.
- Local Supabase integration completed 214/215 in the combined run. The sole
  failure was a test-window ambiguity around an event queued before confirmed
  channel removal; the corrected post-removal-only assertion passed against
  the isolated local Realtime service.
- The one-click lifecycle was hardened for slow fresh Codespaces: startup stays
  bounded at six minutes, and cleanup performs bounded repeated scans of only
  the explicit local container allowlist to catch services created after a
  timed-out startup. No hosted Supabase environment is involved.
- Vendor-handover maintainability is assessed at approximately 7.5/10. Routine
  maintenance and feature work are well protected; virtualization, Realtime
  ownership and native notification navigation remain specialist areas.
- Required before promotion: manual Android and iOS checks for inbox resume,
  push/bell exact-message routing, historical-message landing, club-admin and
  operational chats, reactions/send, and offline/reconnect recovery.

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
- M4c begins pagination extraction with Team's existing pure older-page merge
  rule. The helper deduplicates by immutable message id, deliberately lets the
  current in-memory row win when a page boundary repeats an id, and applies the
  shared chronological ordering before the existing reconciliation registry.
  Fetches, enrichment, cache updates, `hasOlderMessages`, Virtuoso anchoring and
  Realtime ownership remain in `TeamChatPage`.
- Club and Broadcast currently concatenate older pages without Team's explicit
  boundary rule, while Group couples its deduplication to a separate reactions
  array. M4c does not normalize those differences without independent
  characterization. Initial verification passed 127 focused contracts,
  TypeScript, focused lint and the Playwright older-history journey covering
  boundary deduplication and visible-anchor preservation. No runtime defect was
  found.
- M4c now applies the same message-only boundary merge to Group after
  independently characterizing its cache shape. Its separately stored reaction
  rows retain their original prepend expression and lifecycle; fetching,
  enrichment, cache ownership and Virtuoso behavior remain page-owned.
  Extension verification passed 128 focused contracts, TypeScript, focused
  lint, and three Group Playwright journeys covering exact-scope send,
  optimistic reaction visibility/deduplication and denied-write rollback. No
  runtime defect was found.
- M4c now also extracts the distinct strict-timestamp prepend rule shared by
  Club and Broadcast. Their queries retain the exact `created_at < oldest`
  boundary, reverse the backend page before enrichment and intentionally
  concatenate without client-side deduplication or reordering. This is kept
  separate from the Team/Group current-row-wins merge so the refactor does not
  invent new pagination semantics.
- Club/Broadcast extension verification passed 134 focused contracts,
  TypeScript, focused lint and three Playwright journeys covering Club's exact
  send scope plus authorized and read-only Broadcast behavior. No runtime
  defect was found.
- M4c extends the strict-timestamp prepend boundary to Direct Message. The
  exact conversation-scoped fetch, enrichment and reconciliation remain in the
  page, and the fully merged array is still persisted through
  `cacheDirectMessages` before the React Query cache result is returned.
- Direct Message extension verification passed 135 focused contracts,
  TypeScript and focused lint, plus four Playwright journeys covering denied
  permission, exact-scope send and usable desktop/narrow-phone composers. No
  runtime defect was found.
- Club Admin has no older-page pagination to extract: although its initial read
  computes whether more than 15 messages exist, the scroller is explicitly
  wired with `hasOlderMessages={false}` and a no-op loader. This pre-existing
  functional gap is documented for a separate behavior change and is not fixed
  or locked in as desired pagination behavior by M4.
- M4d begins cache hydration extraction with Club Admin's notification-cache
  row merge. Existing query rows still win on duplicate ids, missing cached
  rows are added chronologically, legacy array/envelope placeholder shapes are
  retained, and bounded empty/error recovery remains page-owned.
- M4d initial verification passed 140 focused contracts, TypeScript and focused
  lint. All eight Club Admin Playwright journeys passed, covering inbox-to-
  thread consistency, delayed hydration, one/two transient empty responses,
  usable one-message cache, exhausted-error retry UI, authoritative empty state
  and exact-scope send. No new runtime defect was found.
- M4d now extracts the shared placeholder-source decision used by Team, Club
  and Group without merging their different cache envelopes. A notification
  preload cache is usable only at five or more messages; otherwise an existing
  query snapshot wins. With no previous snapshot, ordinary cache requires at
  least two messages. Each page still owns cached-row transformation,
  reactions, `hasOlderMessages`, offline handling and local render seeding.
  Direct and Broadcast retain their different rules.
- Placeholder-selection verification passed 165 focused contracts, TypeScript
  and focused lint. The exact team notification-bell journey and three native-
  like journeys passed: Android cached-inbox settled reveal, Android in-app
  exact-row no-jolt and iOS in-app exact-row no-jolt. No runtime defect was
  found.
- M4d review leaves Direct and Broadcast placeholder logic page-owned. Direct
  ignores previous snapshots and requires at least two cached messages;
  Broadcast preserves any previous snapshot and otherwise accepts any non-empty
  cache. They are not duplicated business behavior, so combining them would add
  abstraction without improving correctness. M4d cache hydration extraction is
  complete.
- M4e begins Realtime event-application extraction with pure React Query
  envelope helpers for edit and delete. Club and Broadcast now preserve query
  metadata while delegating only the message-array transformation. Channel
  creation, exact table/filter, reconciliation recording, soft-delete outcome,
  local rendered state and reaction handlers remain page-owned and in their
  original order.
- M4e initial verification passed 153 focused contracts, TypeScript and focused
  lint. Two Realtime Playwright journeys passed for edit/soft-delete and
  duplicate delivery, along with three Club/Broadcast exact-send/read-policy
  journeys. No runtime defect was found.
- M4e now extends the same query-envelope edit/delete boundary to Team. The
  immutable `team_id` payload guards remain ahead of reconciliation and cache
  application, while channel ownership, the exact Realtime filter and local
  rendered-state updates remain page-owned. This preserves the recently added
  cross-team isolation protections while removing Team's duplicate envelope
  reconstruction.
- M4e now extends the message-envelope edit/delete boundary to Group while
  retaining Group's distinct `{ messages: [], reactions: [] }` fallback when
  query data is absent. Reaction rows, channel ownership, Realtime filters,
  reconciliation order and local rendered-state updates remain page-owned.
- M4e completes the update/delete envelope extraction across Direct Message
  and Club Admin while retaining their distinct absent-cache behavior. Direct
  keeps both hard-delete and soft-delete paths; Club Admin continues to expose
  only its existing soft-delete update path. Insert enrichment, reactions,
  channel filters, local state and permission behavior remain unchanged.
- The subsequent lifecycle inventory found a pre-existing Direct Message
  defect: its reconciliation cleanup shared an effect with `messagesData`, so
  ordinary query-cache transitions could clear edit/delete tombstones before a
  stale response arrived. The correction moves cleanup into a scope-lifetime
  hook that runs only when the conversation scope changes or unmounts; cache
  seeding and all other Direct Message behavior remain unchanged.
- M4f adopts the tested scope-lifetime cleanup hook across Team, Club, Group,
  Club Admin and Broadcast. Each surface retains its exact scope key, cache
  seeding, query dependencies and Realtime channel teardown; only the repeated
  reconciliation-registry cleanup effect is shared.
- M5a begins composer extraction with the identical native IME submission
  boundary shared by Team, Club, Group, Direct and Club Admin. It preserves the
  `chat:message-sent` event, blur-before-read, one-task retry and
  `preventScroll` refocus behavior that protects Gboard/iOS composition and
  viewport stability. Broadcast retains its distinct non-IME send path.
- M5b extracts the pure sendable-content and inline-poll text rules used by
  all composers, so handler guards and button state share one definition.
  Rapid click coalescing is now explicitly protected at the shared send button.
  Scope permissions, mutation payloads, optimistic state and retry behavior
  remain page-owned.
- M5c extracts the common edit intent shared by all six surfaces: beginning an
  edit retains the original message identity, cancellation clears the edit and
  draft, and persistence uses the immutable message id with trimmed text.
  Message tables, Supabase mutations, authorization, query invalidation,
  page-specific toasts and reply/focus behavior remain explicit in each page;
  Group Chat also retains its full message object and distinct focus behavior.
  Verification passed 85 focused composer/page contracts, TypeScript, focused
  lint, the production build and the real reply/edit Playwright journeys.
- M5d extracts exact scheduled-message target construction and post-schedule
  composer cleanup across all six surfaces. Missing scoped ids still suppress
  Team, Club, Group, Direct and Club Admin targets, while Broadcast retains its
  id-free global target. Existing image cleanup differences are explicit:
  Team, Club, Group and Broadcast clear the image owned by their schedule
  dialog; Direct and Club Admin retain their current text-only cleanup. Pro
  checks, support-DM attachment restrictions, upload recovery, backend writes
  and retry policies remain locally owned. Verification passed 123 focused
  contracts, 73 scheduled-message tests, TypeScript, focused lint, production
  build and seven cross-surface send/attachment Playwright journeys.
- M5e adopts one typed failed-send recovery boundary across all six surfaces.
  Each mutation now owns a collision-resistant temporary id and captures its
  text, attachment, reply, poll and start time before optimistic composer
  cleanup. A genuine online failure removes only that mutation's temporary row
  and restores only still-empty composer fields, preserving newer input and
  concurrent/Realtime rows. Authoritative-success suppression now requires a
  bounded creation time plus exact author, text, attachment and reply identity,
  so an older identical message cannot mask a failed new send. Offline queues,
  permissions, tables, payloads, toasts and Realtime ownership remain local.
  Verification passed focused helper and orchestration tests, failed-send and
  attachment rollback journeys across all six surfaces, the older-identical-
  message browser regression, TypeScript and the production build. During
  verification a pre-existing refactor defect was exposed and corrected:
  Club Chat's optimistic row passed an undefined `queryKeyMemo`; it now uses
  its canonical `clubMessagesQueryKey`.
- M5f extracts the confirmed-delivery Vault side effect shared by Team, Club,
  Group and Club Admin into one typed hook. Each page still owns its delivery
  decision, offline queue payload and exact Vault scope; the hook owns only the
  fire-and-forget mirror after confirmation. Direct Message and Broadcast keep
  their intentional no-Vault behavior. Rejected inserts still perform zero
  Vault work, queued sends mirror only after server delivery, restricted group
  and club-admin scopes are preserved, and Vault failures cannot turn a sent
  message into a failed send. Verification passed 96 focused contracts, 35
  messaging/Vault Playwright journeys, TypeScript, focused lint and the
  production build. No runtime defect was found.
- M5g extracts the successful-send composer reset shared by all six surfaces.
  It clears text, attachment and reply state together, plus poll state only on
  composers that own it. Each page retains the original reset timing: Team,
  Club, Group and Broadcast clear inside optimistic `onMutate`, while Direct
  Message and Club Admin clear after dispatch. Permission checks, support-DM
  attachment restrictions, gallery nudges, upload behavior, offline queueing
  and failed-send attachment restoration remain page-owned. Verification
  passed 160 focused contracts, all 29 cross-surface messaging Playwright
  journeys, TypeScript, focused production-helper lint and the production
  build. No runtime defect was found.
- M6a begins page composition with one native-safe outer chat frame shared by
  all six surfaces. It owns only the measured viewport height, overflow and
  overscroll containment, the keyboard-scroll lock marker and forwarding of
  swipe-back touch boundaries. Header, thread, Virtuoso, composer, routing,
  permissions and all child ordering remain page-owned. Verification passed
  65 focused viewport/composition contracts, TypeScript, focused lint, Android
  and iOS exact-message no-jolt journeys, reply/edit identity journeys and the
  production build. No runtime defect was found.
- M6b moves the repeated header search overlay and trigger into the existing
  `ChatHeaderShell` for Team, Club, Group, Direct Message and Broadcast. Each
  page still owns its search state, remote history callback and page-specific
  actions/menu, whose ordering and contents are unchanged. Club Admin retains
  its intentionally custom participant header and page-owned search control.
  Verification passed 63 focused component/orchestration/search contracts,
  the full-history older-message Playwright journey, TypeScript, focused lint
  and the production build. No runtime defect was found; the first component
  test failure was a test-harness omission of the existing router context.
- M7a begins the optional virtualization tranche by moving rich-token and
  external-link preview measurement out of the 2,300-line Virtuoso component
  into a pure tested module. All reservation constants and calculation order
  remain unchanged; Virtuoso ownership, row signatures, measured-height cache,
  scroll timing and anchoring are untouched. Six direct contracts now protect
  mention/markdown visibility, rich-token removal, event/YouTube handling,
  ordinary-URL bounds, case-insensitive deduplication, preview caps and every
  reserved card height. Verification passed 61 focused contracts, three
  Chromium anchor/media/reaction journeys, the Android exact-row no-jolt
  journey, TypeScript, focused new-module lint and the production build. No
  runtime defect was found. The broad Virtuoso file retains its pre-existing
  lint debt; this slice introduced no new lint findings.
- M7b moves the measured-height cache signature into a second pure module,
  without changing its compact format or any cache/scroll behavior. Twelve
  direct contracts prove invalidation for text edits, edited state, replies,
  reactions, preview hydration, read-state layout, author-label length,
  ownership, date separators, previous/next grouping and newly known image
  aspect ratios; non-layout preview metadata remains intentionally stable.
  Verification passed 73 focused contracts, Chromium prepend-anchor and
  reaction-first-paint journeys, the Android exact-row no-jolt journey,
  TypeScript, focused extracted-module lint and the production build. No
  runtime defect was found.
- M7c completes the pure measurement boundary by extracting the remaining
  static row-height estimator from the Virtuoso component. Its viewport-width
  calculation, grouping/date chrome, author header, reply, image, preview,
  reaction, edited-state, minimum/maximum bounds and measured-cache preference
  retain the same constants and calculation order. Seven direct contracts now
  pin representative exact heights, grouped-row behavior, reply/image space,
  reaction wrapping, long-message capping and signature-aware cache reuse.
  Verification passed 80 focused contracts, Chromium prepend-anchor,
  attachment and reaction-first-paint journeys, the Android exact-row no-jolt
  journey, TypeScript, focused extracted-module lint and the production build.
  No runtime defect was found.
- M7d extracts Virtuoso's stable header, footer, native-safe scroller and
  layout-contained item wrappers into a dedicated presentation module. The
  component identities, padding context, scroll-lock/virtualized markers,
  scrollbar class, overscroll containment, iOS momentum scrolling and
  `layout style` (not paint) row containment are unchanged and now protected
  by direct component tests. Pagination, anchoring, jump hydration and timing
  remain in the parent. Verification passed 83 focused contracts, Chromium
  prepend anchoring, the Android exact-row no-jolt journey, TypeScript,
  focused extracted-module lint and the production build. No runtime defect
  was found.
- M7e extracts the remaining platform/DOM safety helpers: Capacitor and
  user-agent Android WebView detection, message-id CSS escaping, and the
  narrowly scoped ResizeObserver-loop error guard. Five direct contracts pin
  native-bridge detection and failure fallback, both Android markers, CSS
  native/fallback escaping, and ensure unrelated errors are never suppressed.
  Verification passed 88 focused contracts, exact out-of-window notification
  and full-history-search journeys, TypeScript, focused lint and the production
  build. The Android exact-row no-jolt sampler intermittently recorded one
  32px movement while the correct target remained open; it then passed three
  consecutive isolated repetitions. No threshold was weakened and no runtime
  defect attributable to this extraction was found.
- M7f extracts the diagnostics-only row probe from the Virtuoso controller.
  Its render-churn tracking, layout-effect measurement, estimator comparison
  and row classification markers are unchanged and now have direct tests for
  initial measurement and estimator/row-type updates. The probe remains
  mounted only when virtualization diagnostics are enabled, so normal runtime
  behavior is unaffected. Verification passed 90 focused contracts, Chromium
  prepend anchoring, the Android exact-row no-jolt journey, TypeScript,
  focused lint and the production build. No runtime defect was found.
- M7g extracts the exact-message jump hydration overlay into a stable tested
  presentation component. The solid semantic background, no-pointer-events
  behavior, seven alternating fixed skeleton rows, 75% cap and 260ms opacity
  fade are unchanged; backdrop filtering remains absent to protect Android
  WebView compositing. Jump target selection, hydration state, reveal timing
  and timers remain in the controller. Verification passed 93 focused
  contracts, exact out-of-window notification landing, Android in-app
  exact-row no-jolt and Android cold old-history push journeys, TypeScript,
  focused lint and the production build. No runtime defect was found.
- M7h extracts the always-mounted measured-height cache wrapper from the
  controller while preserving its two layout effects and 600ms idle policy.
  Initial/signature writes, non-Android live observation, Android observer
  avoidance, rAF/120ms/360ms late captures, short observer lifetime and full
  cleanup retain their existing order and timing. Three direct contracts now
  protect initial measurement, signature-aware rewrites, observer updates and
  disconnection. Verification passed 96 focused contracts, Chromium prepend
  anchoring and reaction-first-paint journeys, the Android exact-row no-jolt
  journey, TypeScript, focused lint and the production build. No runtime
  defect was found.
- M7i extracts the memoized row adapter and replaces its `any`-based render,
  message-array and ref contract with explicit adapter types. The intentional
  memo rule remains ID + layout signature: upstream object churn does not
  repaint a stable row, while signature changes do; an ID absent from the live
  index renders nothing. Four direct contracts now protect those behaviors.
  Image predecode access was typed without changing its URL fallback order.
  Verification passed 100 focused contracts, Chromium prepend anchoring and
  reaction-first-paint journeys, the Android exact-row no-jolt journey,
  TypeScript, focused lint and the production build. No runtime defect was
  found.
- M7j removes the controller's final three explicit `any` boundaries by
  deriving the safe scroll payload from `VirtuosoHandle`, typing the Virtuoso
  component map with its message/context generics, and relying on the
  structurally identical basic-list handle for the kill-switch ref. Runtime
  expressions and branch behavior are unchanged. Verification passed 100
  focused contracts, Chromium prepend anchoring, the Android exact-row
  no-jolt journey, TypeScript and the production build. The controller now
  has zero explicit-`any` lint errors; only its separately deferred hook
  dependency warning remains. No runtime defect was found.
- M7k resolves the controller's final hook dependency warning after confirming
  that `safeScrollToIndex` has stable `useCallback(..., [])` identity and reads
  changing values only through refs. Adding it to the own-message pin effect
  cannot restart that effect today, while preventing a stale closure if the
  helper later gains dependencies. Verification passed 100 focused contracts,
  optimistic-send/reply/edit Playwright journeys, the Android exact-row
  no-jolt journey, TypeScript, clean controller lint and the production build.
  No runtime defect was found.
- M7l extracts the prepend-defer state machine and its user-input/scroll-session
  bridge from the Virtuoso controller. Its 250ms motion window, 300ms input
  session, stationary-page hold and next-upward-motion flush are unchanged.
  Four direct hook contracts now prove immediate append/edit delivery, holding
  a stationary pure prepend, flushing it on the next user-driven upward motion,
  and immediate prepending during active motion. Verification passed 104
  focused contracts, the Chromium older-history anchor journey, the isolated
  Android exact-row no-jolt journey, TypeScript, focused lint and the production
  build. A concurrent Android run timed out while the build and Vitest were
  saturating the Codespace; its isolated rerun passed without a positioning
  assertion failure. No runtime defect was found.
- M7m extracts the global jump-hydration lifecycle from the Virtuoso controller
  into a dedicated hook. Pre-mount jump seeding, start/end event subscription,
  the 650ms quiet and 8000ms maximum visual-settle gate, 80ms settled fade,
  120ms no-scroller fallback, 300ms overlay unmount and all cancellation paths
  remain unchanged. Four direct contracts now protect pre-mount notification
  jumps, settle-before-reveal behavior, restart/unmount cancellation and the
  fallback timing. Verification passed 108 focused contracts, Chromium cold
  exact-message landing, the Android exact-row no-jolt journey, TypeScript,
  focused lint and the production build. A parallel Playwright attempt could
  not start its second fixed-port web server; the affected Android journey
  passed sequentially. No runtime defect was found.
- M7n extracts message-window preparation from the Virtuoso controller. The
  first occurrence of every message ID remains authoritative, duplicate
  diagnostics retain their total-occurrence count, the ID map remains indexed
  against the de-duplicated window, and image predecode preserves snake-case
  URL precedence with camel-case fallback. Five direct contracts protect those
  rules, including preventing a discarded duplicate image from being warmed.
  Verification passed 113 focused contracts, Chromium duplicate-boundary
  anchoring, attachment and reaction-first-paint journeys, the Android exact-row
  no-jolt journey, TypeScript, focused lint and the production build. No runtime
  defect was found.
- M8a begins page-level controller adoption with a typed composer controller on
  Broadcast. It owns only persisted draft, attachment, reply, edit and poll
  state plus send eligibility, payload construction, successful reset and
  conditional failed-send restoration. Broadcast retains app-admin permission,
  Supabase writes, optimistic cache rows, offline queueing, upload, scheduling,
  typing and scroll timing. Five direct controller contracts protect draft and
  eligibility behavior, edit transitions, exact poll/reply payloads, atomic
  reset and non-destructive failure restoration. Verification passed 83 focused
  contracts, Broadcast failed-send, exact-table send and ordinary-reader
  Playwright journeys, TypeScript, clean controller lint and the production
  build. No runtime defect was found.
- M8b adopts the same composer controller on Direct Message while preserving
  its distinct timing: the page still performs native IME flushing, permission
  checks and mutation dispatch before invoking the controller's reset. Support
  conversation reply/attachment restrictions, shared-club gates, offline
  queueing, exact conversation payloads, optimistic rows, cache replacement,
  typing, upload and scheduling remain page-owned. The controller's reply type
  was generalized to require only immutable identity so Direct Message retains
  its richer author metadata without conversion. Verification passed 91
  focused contracts, all six Direct Message permission/start/send/failure and
  desktop/mobile composer Playwright journeys, TypeScript, clean controller
  lint and the production build. No runtime defect was found.
- M8c adopts the composer controller on Club Admin chat without changing its
  conversation/participant resolution, cached-message preservation, transient
  empty retry policy or authoritative-empty state. Native IME timing, exact
  conversation writes, optimistic rows, offline queueing, Vault delivery,
  attachment and poll handling, scheduling, typing and scrolling remain
  page-owned. Verification passed 123 focused composer/Vault/orchestration
  contracts, all nine Club Admin non-blank/delayed/empty/retry/send/failure
  Playwright journeys, TypeScript, clean controller lint and the production
  build. No runtime defect was found.
- M8d adopts the composer controller on Club Chat while preserving its
  optimistic reset boundary inside `onMutate` and mutation-specific rollback.
  Club Pro access, announcement behavior, exact `club_messages` scope, offline
  queueing, Vault delivery, gallery publishing, polls, scheduling, typing and
  scroll timing remain page-owned. Verification passed 123 focused
  composer/Vault/orchestration contracts, both exact Club Chat send and online
  failure-restoration Playwright journeys, TypeScript and the production build.
  No runtime defect was found.
- M8e adopts the composer controller on Team Chat while preserving immutable
  `team_id` scoping and the optimistic reset boundary inside `onMutate`. Team
  membership and role behavior, cross-team cache isolation, Pro access, Vault
  delivery, recent-match gallery publishing, event/board/poll attachments,
  scheduling, typing and scroll timing remain page-owned. Verification passed
  123 focused composer/Vault/orchestration contracts, three cached-scope
  guards, and five Team Chat browser journeys covering duplicate-safe
  optimistic delivery, failed-send rollback, scoped image upload and complete
  attachment restoration. TypeScript and the production build passed. No
  runtime defect was found.
- M8f completes composer-controller adoption across the six messaging surfaces
  with Group Chat. Exact `group_id` writes, membership and allowed-role access,
  operational-group behavior, Vault audience metadata, offline queueing,
  optimistic cache rows, attachment/poll/scheduling behavior, typing and scroll
  timing remain page-owned. Group Chat's existing edit transition uniquely
  retains a selected reply target; a narrow controller option and direct test
  preserve that behavior rather than normalizing it silently. Verification
  passed 124 focused composer/Vault/orchestration contracts and four Group Chat
  browser journeys covering exact-scope send, failed-send restoration and
  optimistic reaction success/rollback. TypeScript and the production build
  passed. No runtime defect was found.
- M8g consolidates the completed controller tranche across the broader
  messaging baseline. Source-text characterizations were updated to assert the
  new controller boundary instead of requiring the retired page-local helper
  calls; the underlying edit, permission, attachment-restoration and schedule
  guarantees remain asserted. All 1,196 tests across 128 messaging-related
  unit/component/characterization files passed. The combined cross-surface and
  navigation Playwright run passed 88 of 89 journeys; the sole inbox Realtime
  preview convergence miss passed 3/3 unchanged isolated reruns and exercises
  inbox orchestration outside the composer tranche, so it is recorded as a
  suite-load timing flake rather than a runtime defect. TypeScript, focused
  lint and the production build passed.
- M9a begins the next inbox-maintainability tranche by extracting the pure
  first-reveal policy from `MessagesPage`. Five ordering-source states, cached
  and live data availability, online/offline behavior, the bounded release
  ceiling and the one-way stable-reveal latch now enter one typed decision
  boundary. Query ownership, the 3.5-second timer, session latch, cache reads,
  rendering and native lifecycle effects remain page-owned. Eight direct
  contracts protect cold online loading, React Query `initialData` refetches,
  settled errors, offline cached reveal, ceiling expiry, warm-latch behavior
  and prevention of stale cached-order bypass. Verification passed 105 focused
  inbox/resume tests, TypeScript and focused lint. The Android cached-order
  no-jolt journey and Android/iOS inactivity re-entry journeys all passed. A
  browser-only wiring omission found during the first run was corrected before
  completion and is now protected by a source-consumption assertion.
- M9b extracts the sticky-versus-cached display-source decision shared by the
  Team, Club and Group inbox lists. Non-empty sticky snapshots still win;
  offline and not-yet-fetched sources may use the user-scoped cache; and a
  settled online empty array remains authoritative so deleted conversations
  cannot be resurrected. `useStickyList`, query lifecycle state, cache reads,
  role filtering and rendering remain page-owned. Seven direct contracts pin
  identity preservation and the complete live/cache/offline/empty matrix.
  Verification passed 113 focused inbox and resume tests, TypeScript, focused
  lint, Android cached-order no-jolt, Android inactivity re-entry and iOS
  inactivity re-entry journeys. No runtime defect was found.
- M9c extracts role-aware Group inbox visibility into a typed pure boundary.
  App-admin and committee access, personal groups, exact club/team scope,
  mini-league membership, unrestricted groups and the offline cached-role
  fallback retain their existing behaviour. Online scoped groups continue to
  fail closed while roles are unavailable. Ten direct contracts cover the
  permission matrix. Verification passed 123 focused inbox and lifecycle tests,
  TypeScript and focused lint; Android cached-order no-jolt plus Android/iOS
  inactivity re-entry journeys also passed. No runtime defect was found.
- M9d extracts deterministic inbox search and active-club filtering for league,
  group, team, club and direct-message rows. Exact club/team and competition
  isolation, personal-group and DM membership resolution, hidden-conversation
  revival, empty-DM suppression, Ignite Support visibility and source ordering
  retain their existing behaviour. Query ownership and the deliberate
  keep-visible state while club membership is loading remain page-owned. Fourteen
  direct contracts cover the policy matrix. Verification passed 137 focused
  inbox and lifecycle tests, TypeScript and focused lint; the cross-club
  notification route, Android cached-order no-jolt and iOS inactivity re-entry
  journeys passed. No runtime defect was found.
- M9e extracts cached direct-message hydration and sticky/live/offline source
  selection. Cached preview author identity, image/text normalization, creation
  metadata fallback, sticky-row precedence and offline-only cache fallback retain
  their existing behaviour. Query ownership, `useStickyList`, filtering,
  Realtime and rendering remain page-owned. Eight direct contracts cover the
  source matrix. Verification passed 133 focused inbox and lifecycle tests,
  TypeScript and focused lint; the Android cached-order no-jolt and cold-offline
  cache-remount journeys passed. The latter required a persistent command
  session because its 40.9-second runtime outlived the initial command wrapper;
  this was a runner-session issue, not an application defect. No runtime defect
  was found.
- M9f extracts unified inbox composition behind one typed orchestration
  boundary while retaining explicit broadcast, club, team, league, group,
  direct-message, club-admin and support builders. Cross-surface row order,
  unread and mute precedence, definitive Pro locking, personal-group hiding,
  club-admin search, support de-duplication and final draft attachment remain
  unchanged. Queries, permissions inputs, stable-model publication, Realtime,
  rendering and navigation remain page-owned. Six direct contracts cover the
  composition matrix. Verification passed 150 focused inbox and policy tests,
  TypeScript and focused lint; DM-start, club-admin preview/thread parity and
  Android cached-order no-jolt journeys passed. No runtime defect was found.
- M9g consolidates event, Vault-folder and Vault-file preview-reference
  extraction into one deterministic pass over the published inbox model.
  Established token parsing, lower-case normalization, de-duplication and
  first-seen ordering remain unchanged, preserving stable query keys. The
  three enrichment queries, cache cadence and rendering remain page-owned.
  Six direct contracts cover empty, mixed, repeated, ordered, upper-case and
  malformed token inputs. Verification passed 141 focused inbox tests,
  TypeScript and focused lint; the Android cached-order no-jolt journey passed.
  No runtime defect was found.
- M9h extracts inbox group-creation capability, empty/search presentation and
  scoped Free/Pro upgrade-banner decisions. App-admin bypass, administrator and
  committee Pro requirements, unresolved-entitlement no-flash behaviour,
  selected-club isolation and upgrade-target fallbacks remain unchanged.
  Queries, backend entitlement enforcement, rendering and navigation remain
  page-owned. Ten direct contracts cover the policy matrix. Verification passed
  154 focused inbox and policy tests, TypeScript and focused lint; the
  new-message/DM entry and Android cached-order no-jolt journeys passed. No
  runtime defect was found.
- M9 closeout verifies the cumulative inbox-policy tranche before any
  higher-risk query-orchestration work. The complete frontend estate passed
  3,869 tests across 341 files, with three intentional environment/feature
  skips. All 90 messaging browser journeys passed cumulatively: the combined
  run completed 89/90, and the sole miss passed its corrected focused rerun.
  That miss was a harness defect which required an off-screen Virtuoso row to
  remain mounted while testing offline cache persistence; the journey now uses
  a guaranteed initial-window row, while dedicated notification tests continue
  to protect exact old-message landing. TypeScript and the production build
  passed. No runtime defect was found. M9 is closed; M10 must begin as a fresh,
  independently reviewable tranche.
- M10a begins read-only inbox query extraction with the member-club preview
  repository. The exact `user_roles` scope, active non-shell club filters,
  deduplicated club identifiers, optional latest-message RPC, legacy per-club
  fallback and batched cached-profile lookup are preserved. React Query's key,
  enablement, retries, reconnect policy, stale time, jittered polling, cache
  lifetime, initial data and placeholder behaviour remain page-owned and
  unchanged; Realtime and mutations are untouched. Five new repository
  contracts cover empty membership, fail-closed role discovery, RPC mapping,
  authoritative empty RPC results and fallback/profile batching. Verification
  passed all 48 repository tests, 173 focused inbox/guard tests and four
  targeted browser journeys covering exact club-chat scope, inbox paint budget,
  Realtime preview convergence and offline recovery. TypeScript, focused lint
  for the extracted boundary and the production build passed. `MessagesPage`
  reduced from 3,032 to 2,952 lines. No runtime defect was found.
- M10b extracts the member-team preview read behind the same typed repository
  boundary. Exact user-role and team identifiers, active-team filtering,
  deleted/purged parent-club exclusion, latest-message RPC, legacy per-team
  fallback, announcement authorship and batched regular-author profiles remain
  unchanged. React Query keys, retries, reconnect handling, polling, cache
  timing, initial-data tombstone filtering and placeholder behaviour remain
  page-owned; Realtime and mutations are untouched. Six new contracts protect
  no-membership behavior, fail-closed reads, inactive scope exclusion, exact
  active-team RPC arguments, authoritative empty RPC results and mixed regular/
  announcement fallback mapping. Verification passed all 54 repository tests,
  179 focused inbox/guard tests and three targeted browser journeys covering
  Realtime preview convergence, deleted/recreated-team identity and Android
  cached-order stability. TypeScript, focused repository lint and the
  production build passed. The stale team-recreation source guard was updated
  to assert page delegation plus the extracted repository statements rather
  than requiring those statements to remain page-local. `MessagesPage` reduced
  from 2,952 to 2,841 lines. No runtime defect was found.
- M10c extracts the chat-group preview read while keeping visibility policy
  outside the repository. The optional accessible-group-ID RPC, its deployment
  kill switch, fail-safe RLS-backed full query, active group/team/club filters,
  exact latest-message RPC scope, legacy per-group fallback and batched author
  lookup remain unchanged. Role, personal-group, competition and mini-league
  visibility decisions remain in their existing typed policy boundary. React
  Query keys and timing, cache hydration, Realtime and mutations are untouched.
  Seven new contracts cover authoritative empty access, RPC failure fallback,
  kill-switch behavior, deleted parent isolation, latest-message mapping,
  authoritative empty previews and fallback/profile batching. Verification
  passed all 61 repository tests, 186 focused inbox/guard tests and four browser
  journeys covering exact group send scope, optimistic group reactions, exact
  group-notification routing and Android cached-order stability. TypeScript,
  focused repository lint and the production build passed. `MessagesPage`
  reduced from 2,841 to 2,747 lines. No runtime defect was found.
- M10d extracts the latest broadcast preview read before the higher-risk direct
  message tranche. Exact descending timestamp order, one-row limit, empty-feed
  result, optional cached author lookup and the established nested profile
  shape remain unchanged. Broadcast authorization, composer access, React Query
  keys and timing, Realtime and mutations remain page- or backend-owned. Four
  new contracts protect the exact query, unauthored broadcasts, resolved author
  display names and unavailable-profile fallback. Verification passed all 65
  repository tests, 190 focused inbox/guard tests and four browser journeys
  covering app-admin send, ordinary-user read-only access, exact broadcast
  notification routing and Android cached-order stability. TypeScript, focused
  repository lint and the production build passed. `MessagesPage` reduced from
  2,747 to 2,723 lines. No runtime defect was found.
- M10e1 begins direct-message extraction with only latest-message retrieval.
  The batch RPC remains preferred; a successful empty RPC remains authoritative;
  and RPC failure retains one descending, one-row query per immutable
  conversation ID. Participant selection, profile fetching and layered profile
  fallbacks, hidden-conversation policy, persistent cache writes, React Query,
  Realtime and mutations remain page-owned. Four new contracts cover an empty
  scope, exact RPC mapping, authoritative empty results and the complete legacy
  fallback query. Verification passed all 69 repository tests, 194 focused
  inbox/guard tests and four browser journeys covering DM creation entry, exact
  DM send scope, exact DM-notification routing and Android cached-order
  stability. TypeScript, focused repository lint and the production build
  passed. `MessagesPage` reduced from 2,723 to 2,691 lines. No runtime defect
  was found.
- M10e2 extracts the current user's direct-conversation membership read and
  peer-ID derivation. The exact participant-one-or-participant-two filter,
  descending `updated_at` order, error propagation, empty result and peer
  selection from either participant position remain unchanged. Profile reads,
  layered current/previous/global profile fallback, latest-message joining,
  hidden-conversation policy, persistent caching, React Query, Realtime and
  mutations remain page-owned. Three new contracts protect exact scoping and
  order, empty membership and fail-closed errors. Verification passed all 72
  repository tests, 197 focused inbox/guard tests and four browser journeys
  covering DM creation entry, exact DM send scope, exact DM-notification
  routing and Android cached-order stability. TypeScript, focused repository
  lint and the production build passed. `MessagesPage` reduced from 2,691 to
  2,683 lines. No runtime defect was found.
- M10e3 extracts only the pure DM peer-profile selection policy. A fresh named
  profile remains authoritative; its missing avatar falls back to the previous
  inbox identity and then global cache; a previous known name survives a fresh
  null/empty name; global cache is the next fallback; and an identity-only fresh
  result remains usable when no named source exists. Profile reads, cache
  refreshes, previous-profile map construction, message joining, persistence,
  React Query, Realtime and mutations remain page-owned. Seven new contracts
  cover the complete precedence and avatar matrix. Verification passed 87
  direct-source/repository tests, 204 focused inbox/guard tests and five browser
  journeys covering DM entry, exact notification routing, Android no-jolt and
  Android/iOS inactivity recovery. TypeScript, focused policy lint and the
  production build passed. `MessagesPage` reduced from 2,683 to 2,671 lines.
  No runtime defect was found.
- M10e4 extracts the pure previous-known peer map used during DM refresh. Live
  React Query identities remain authoritative; persistent cache fills only
  missing peers or peers whose live identity has no usable name; malformed and
  unnamed rows remain excluded. Query-cache reads and persistent-cache reads
  still occur in `MessagesPage`; only deterministic map construction moved.
  Five new contracts cover live-over-disk precedence, cached gap filling,
  invalid live rows, valid cache recovery and empty sources. Verification
  passed 92 direct-source/repository tests, 209 focused inbox/guard tests and
  four browser journeys covering inbox paint budget, exact DM notification
  routing and Android/iOS inactivity recovery. TypeScript, focused policy lint
  and the production build passed. `MessagesPage` reduced from 2,671 to 2,664
  lines. No runtime defect was found.
- M10e5 extracts DM peer-profile loading as a separate asynchronous boundary.
  Fresh cached-profile selection remains preferred, successful non-empty data
  still refreshes the global profile cache, one timestamp is attached to the
  returned fresh map, and a thrown fresh/cache-refresh path falls back to stale
  profiles with the established 15-second bound. Successful empty data remains
  authoritative, and a failed stale fallback still propagates. Conversation
  assembly, previous/global profile selection, persistence, React Query,
  Realtime and mutations remain page-owned. Five new contracts cover the full
  I/O matrix. Verification passed 97 direct-source/repository tests, 264 focused
  inbox/guard tests and five browser journeys covering DM entry, exact DM
  notification routing, Android no-jolt and Android/iOS inactivity recovery.
  TypeScript, focused source lint and the production build passed.
  `MessagesPage` reduced from 2,664 to 2,649 lines. No runtime defect was found.
- M10e6 extracts pure DM conversation assembly. Each immutable conversation ID
  joins only its matching latest-message entry; peer identity is derived from
  either participant position; source metadata is preserved; and the already
  tested fresh/previous/global/identity-only profile policy remains the sole
  identity decision. Persistence payload construction, cache writes, React
  Query, hidden policy, Realtime and mutations remain page-owned. Five new
  contracts cover both participant positions, exact message joining, profile
  inputs, identity-only peers and empty assembly. Verification passed 102
  direct-source/repository tests, 269 focused inbox/guard tests and six browser
  journeys covering DM entry/send, exact notification routing, Android no-jolt
  and Android/iOS inactivity recovery. TypeScript, focused source lint and the
  production build passed. `MessagesPage` reduced from 2,649 to 2,638 lines.
  No runtime defect was found.
- M10e7 extracts pure persistent DM cache-payload construction while retaining
  the actual user-scoped cache write in `MessagesPage`. Only established
  conversation metadata is persisted, absent creation ownership normalizes to
  null, current-user previews retain the `You` label, received previews use the
  resolved peer name or empty fallback, media metadata is preserved, and
  conversations without a latest message create no preview entry. Five new
  contracts cover this complete mapping. Verification passed 107 direct-source/
  repository tests, 274 focused inbox/guard tests and seven browser journeys
  covering DM entry/send, offline cache recovery, exact notification routing,
  Android no-jolt and Android/iOS inactivity recovery. TypeScript, focused
  source lint and the production build passed. `MessagesPage` reduced from
  2,638 to 2,623 lines. No runtime defect was found.
- M10e8 completes the DM inbox tranche by replacing duplicate page-local
  placeholder reconstruction with the existing tested cache hydrator. Cached
  creation metadata, `You`/peer author IDs, image previews, empty placeholders
  and user scoping retain the same contract. The React Query key, polling,
  initial-data freshness, placeholder invocation and actual cache writes remain
  page-owned. Cumulative verification passed 130 DM source/cache/guard tests,
  274 focused inbox/guard tests and twelve browser journeys covering DM entry,
  desktop/mobile send affordances, exact send and notification scope, normal
  inbox paint budget, offline persistence/recovery, Android no-jolt and Android/
  iOS inactivity recovery. TypeScript, focused source lint and the production
  build passed. `MessagesPage` reduced from 2,623 to 2,617 lines. The DM query
  is now a thin coordinator over independently tested membership, preview,
  profile, assembly, persistence and hydration boundaries. No runtime defect
  was found.
- M10f extracts the latest welcome-system-message read behind the typed inbox
  repository boundary. The exact user and `welcome` filters, descending
  creation order, one-row limit and established unavailable-as-empty behavior
  remain unchanged. React Query key, enablement and support-row composition
  remain page-owned. Verification passed all 74 repository tests, 86 focused
  repository/composition/inbox-guard tests, TypeScript, focused lint, the
  production build and the Android cached-order no-jolt journey.
  `MessagesPage` reduced from 2,617 to 2,607 lines. No runtime defect was found.
- M10g1 begins bounded thread-prefetch extraction with Broadcast only. The
  exact selected columns, descending read, page-plus-one sentinel, chronological
  cache result and established non-blocking unavailable behavior remain
  unchanged. Native prefetch suppression, idle scheduling, React Query key and
  stale time remain page-owned; Team, Club and Group are deliberately deferred
  until this slice is independently verified. Verification passed all 77
  repository tests, 89 focused repository/composition/inbox-guard tests,
  TypeScript, focused lint and the production build. Both Broadcast read/send
  journeys and the Android cached-order no-jolt journey passed.
  `MessagesPage` reduced from 2,607 to 2,597 lines. No runtime defect was found.
- M10g2 extends the bounded prefetch repository boundary to Team while keeping
  its immutable `team_id` filter explicit. Selected columns, descending
  page-plus-one read, chronological cache result and non-blocking unavailable
  behavior remain unchanged. Scheduling, native suppression, cap selection,
  React Query keys/stale time and Club/Group prefetch remain page-owned.
  Verification passed all 80 repository tests, 92 focused repository/
  composition/inbox-guard tests, TypeScript, focused lint and the production
  build. Exact Team send scope, cross-team cached-row isolation and Android
  cached-order no-jolt journeys passed. `MessagesPage` reduced from 2,597 to
  2,586 lines. No runtime defect was found.
- M10g3 extends bounded thread-prefetch extraction to Club with its immutable
  `club_id` scope kept explicit. Selected columns, descending page-plus-one
  read, chronological cache result and non-blocking unavailable behavior remain
  unchanged. Scheduling, native suppression, cap selection, React Query key/
  stale time and Group prefetch remain page-owned. Verification passed all 83
  repository tests, 95 focused repository/composition/inbox-guard tests,
  TypeScript, focused lint and the production build. Exact Club Chat send scope
  and Android cached-order no-jolt journeys passed. `MessagesPage` reduced from
  2,586 to 2,575 lines. No runtime defect was found.
- M10g4 completes bounded thread-prefetch extraction with Group while keeping
  its immutable `group_id` scope explicit. Selected columns, descending
  page-plus-one read, chronological cache result and non-blocking unavailable
  behavior remain unchanged. Group visibility stays outside this data read;
  scheduling, native suppression, cap selection and React Query ownership
  remain page-owned. Verification passed all 86 repository tests, 98 focused
  repository/composition/inbox-guard tests, TypeScript, focused lint and the
  production build. Exact Group Chat send scope, optimistic reaction delivery
  and Android cached-order no-jolt journeys passed. `MessagesPage` reduced from
  2,575 to 2,564 lines. No runtime defect was found. M10g is complete across
  Broadcast, Team, Club and Group.
- M10 closeout confirms that all inbox reads now delegate to explicit typed
  repositories or existing query modules. The direct Supabase operations left
  in `MessagesPage` are user-triggered hide/delete mutations and two scoped
  Realtime channel lifecycles; moving those begins a separate higher-risk
  tranche. The complete frontend estate passed 3,939 tests across 341 files,
  with three intentional skips. The 90-case messaging Playwright pack completed
  88/90 under combined load; the Realtime-preview convergence and Android
  exact-row no-jolt timing misses each passed unchanged 3/3 in isolated reruns.
  No threshold or production behavior was changed. TypeScript, focused lint and
  the production build also passed. M10 is technically complete and ready for
  a clean commit checkpoint before any mutation or Realtime refactor.

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
