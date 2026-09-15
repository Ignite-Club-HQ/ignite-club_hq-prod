# Ignite Club HQ — Expanded Refactoring Readiness Assessment

**Date:** 26 July 2026
**Scope:** Frontend production modules beyond the initial Competition/Event/Vault review.
**Method:** Repository-only structural and test-readiness analysis. No production behaviour was changed.

## Implementation and promotion rule

All refactoring described in this assessment must be implemented in the
Codespace on `codespaces-review`, not in Lovable and not directly on `main`.
Each bounded slice must pass focused tests and the complete one-click baseline
before it is proposed for `main`. A green run does not merge the work
automatically: promotion from `codespaces-review` to `main` requires explicit
user approval. Refactoring commits must remain separate from Lovable feature or
defect changes and from deployment or schema work.

## Executive conclusion

The largest maintainability gains will come from four domain programmes:

1. competition administration;
2. messaging and chat;
3. membership and organisation administration;
4. pitch board and AutoSub.

They should not be tackled in raw file-size order. The safest near-term sequence is:

1. harden and refactor competition fixtures;
2. harden membership administration, then extract invitation/membership services;
3. characterize the messaging page controllers and consolidate shared thread behaviour;
4. resolve the known AutoSub fairness contract, then separate planner domain code from dialog UI;
5. continue slimming PitchBoard orchestration around its already-extracted hooks;
6. address Vault, Event Detail and administrative dashboards after dedicated page-level harnesses exist.

## Wider portfolio ranking

Readiness measures how safely structural work could begin today. Value measures likely reduction in vendor support cost.

| Priority | Domain/module | Size/shape | Refactor value | Readiness | Decision |
|---:|---|---|---:|---:|---|
| 1 | Competition fixtures | 2,701 lines; scheduling, CRUD, ladder | High | **7.0/10** | First after Bundle A tests |
| 2 | AutoSub planner/dialog | 5,269 lines; large pure planning core plus UI | Very high | **6.5/10** | Resolve/enforce fairness contract, then extract planner |
| 3 | PitchBoard orchestrator | 3,402 lines; 83 state references, many extracted hooks | Very high | **6.0/10** | Continue only after lifecycle journeys are strengthened |
| 4 | Virtualized chat list | 2,391 lines; no database access, complex scroll state | High | **5.5/10** | Characterize viewport lifecycle before splitting |
| 5 | Media page | 1,954 lines; feed, permissions, Realtime, mutations | Medium-high | **4.5/10** | Add page tests; then extract feed repository/controller |
| 6 | Messaging/inbox domain | inbox 3,338 lines plus four large thread pages | Very high | **4.0/10** | High-value programme; tests first, no immediate consolidation |
| 7 | Team/club detail pages | 2,814 + 2,440 lines; membership/admin/subscription operations | High | **4.0/10** | Characterize destructive and role workflows first |
| 8 | AddTeamMemberSheet | 3,817 lines; invitation/guardian/member workflow | Very high | **3.5/10** | Security-sensitive; transactional tests before extraction |
| 9 | Home page | 3,305 lines; 17 queries, 8 mutations, broad aggregation | Medium-high | **3.5/10** | Extract read models only after page characterization |
| 10 | ManageUsersPage | 1,931 lines; app-admin bulk and destructive operations | High | **3.0/10** | Defer until app-admin journey and failure tests exist |
| 11 | Vault | 5,708 lines; storage and permission orchestration | Very high | **3.5/10** | Dedicated safety harness required |
| 12 | Event detail | 4,242 lines; 19 mutations and 108 table calls | Very high | **4.0/10** | Dedicated mutation characterization required |

## Messaging and chat — deep assessment

### Structural shape

The messaging domain is distributed across:

- `MessagesPage.tsx` — 3,338 lines, 23 query hooks, 53 direct table calls, five RPC call sites, two channels;
- `GroupChatPage.tsx` — 2,631 lines, 27 state references, 21 effects, 28 table calls;
- `TeamChatPage.tsx` — 2,207 lines, 27 state references, 23 effects;
- `ClubChatPage.tsx` — 1,895 lines, 23 state references, 21 effects;
- `DirectMessagePage.tsx` — 1,690 lines, 18 state references, 18 effects;
- `VirtualizedChatMessageList.tsx` — 2,391 lines of scroll, anchoring and virtualization behaviour.

The inbox queries roles, teams, clubs, messages, conversations, group membership, mutes, children/guardians, competitions, events, Vault links and subscriptions. It also owns cache hydration, unread aggregation, preview construction, filtering, polling, prefetch throttling and Realtime invalidation.

The thread pages repeat variations of:

- initial and older-page message loading;
- message cache hydration;
- Realtime insert/update/delete handling;
- send, retry, edit and delete;
- reactions;
- read state and notification reconciliation;
- replies, mentions and attachments;
- search and jump-to-message;
- keyboard, safe-area and scroll anchoring;
- typing and presence;
- pinning, scheduling and Pro gates;
- permission and membership checks.

### Existing strengths

There is meaningful lower-level protection for message queues, forwarding, reads, pinned messages, typing, scheduled messages, unread counts, jump-to-message, image publication, notification routing and many image-viewer gestures. This is valuable but does not prove that each page composes those pieces correctly.

### Missing refactoring gate

Before consolidating chat controllers, add page-level contract tests for each scope:

1. unauthorized and removed members cannot load or send;
2. initial load, cached load and query failure remain distinguishable;
3. older-page prepend preserves the visible anchor;
4. incoming Realtime inserts appear once and do not duplicate optimistic messages;
5. edit/delete Realtime events update the correct row;
6. send failure queues or restores the draft according to scope policy;
7. retry cannot create duplicate messages;
8. reaction add/remove is idempotent and permission-aware;
9. opening a scope marks only that scope read;
10. notification jumps find loaded and older messages;
11. membership revocation tears down the channel and prevents further delivery;
12. composer/keyboard reflow does not move a user reading history;
13. scheduled/pinned/attachment capabilities respect Pro and role policies;
14. teardown removes channels, listeners and timers exactly once;
15. inbox partial query failures do not silently remove conversations;
16. inbox Realtime invalidation is scoped and bounded;
17. hidden/muted conversations remain hidden through refetch;
18. profile, event and Vault preview enrichment failures preserve the conversation row.

### Recommended boundaries after tests

1. Typed conversation read models and preview enrichment.
2. `messagesRepository` functions per scope, sharing typed primitives without hiding table semantics.
3. A tested thread lifecycle controller for pagination/cache/Realtime/read reconciliation.
4. Scope adapters for group, team, club and DM-specific authorization and tables.
5. A composer controller for send/retry/attachments/scheduling.
6. Presentational page shells after behavioural controllers are stable.

Do not create one generic component with dozens of boolean props. Shared lifecycle primitives plus explicit scope adapters will be easier to review and support.

## PitchBoard and AutoSub

### Current position

`PitchBoard.tsx` already imports many extracted hooks, showing that modularization has begun. Its remaining 3,402 lines still coordinate 83 state references, game lifecycle, timer, lineups, substitutions, formations, drawings, persistence, event groups, fill-ins and layouts.

`AutoSubPlanDialog.tsx` combines a substantial planning algorithm, fairness repair/suggestions, diagnostics, simulation, advanced settings and a large dialog UI. The domain has unusually broad tests, including planner matrices, reducer/repair tests, execution tests and fairness sweeps.

### Main blocker

The current fairness acceptance output records many rotation-pool spread-cap breaches while allowing the suite to pass. Until the accepted fairness rule is made explicit and genuinely enforced, a structural rewrite could preserve or obscure an incorrect algorithm.

### Required tests before refactoring

1. Convert agreed feasible fairness cases into blocking acceptance tests.
2. Separate mathematically infeasible cases from planner failures.
3. Verify deterministic plans for identical inputs.
4. Preserve locked-player, goalkeeper, injury and manual-override constraints.
5. Verify plan repair after a missed or late substitution.
6. Verify half-time and phone-lock timer interactions with planned windows.
7. Add an orchestrated PitchBoard journey: start, lock/resume, substitute, halftime, repair and finish.
8. Verify persisted/server state conflicts never regress time or duplicate substitutions.

### Recommended extraction

Move the pure planner, constraint model, scoring and diagnostics into a framework-independent domain package. Keep React state adapters and dialog presentation separate. For PitchBoard, continue moving orchestration into focused hooks with explicit input/output contracts rather than creating another monolithic controller.

## Membership and organisation administration

### Structural shape

`AddTeamMemberSheet.tsx` is 3,817 lines and directly coordinates pending invites, roles, child assignments, guardians, positions, notifications, team invite links, profile search and nine email invocations. `TeamDetailPage`, `ClubDetailPage` and `ManageUsersPage` repeat adjacent role, deletion, subscription and notification responsibilities.

The backend membership and guardian baseline is strong, but component-level orchestration is sparse.

### Required tests before refactoring

1. Exact role/club/team permission matrix for every entry point.
2. Existing-user and email-invite paths produce equivalent intended membership.
3. Multiple guardians preserve child assignments until the last relevant relationship is removed.
4. Duplicate invite and concurrent acceptance remain idempotent.
5. Email failure does not misreport the membership/invite state.
6. Partial child/guardian/position failures do not report complete success.
7. Removing one role does not remove unrelated team or club roles.
8. Team/club deletion and subscription cancellation fail safely and independently.
9. Bulk role operations report per-user partial failure rather than blanket success.
10. App-admin operations cannot be reached by non-admins even through direct invocation.

### Recommended boundaries

- invitation recipient parsing and validation;
- typed membership policy functions;
- transactional invitation/membership RPC service;
- email/notification outbox boundary;
- presentation steps for adult, child and guardian flows.

This domain is a higher security priority than its visual complexity suggests.

## Home, team and club detail pages

These pages are broad read-model aggregators with embedded administrative actions:

- `HomePage.tsx`: 17 query hooks, 78 table calls and eight mutations;
- `TeamDetailPage.tsx`: 15 queries and 38 table calls;
- `ClubDetailPage.tsx`: 14 queries, six mutations and 45 table calls.

They are good candidates for feature-specific read models, but only after tests prove loading, partial error, permission and active-context behaviour. Start by extracting read-only aggregation; do not combine destructive actions into the same refactor.

Priority tests:

1. partial query failure keeps unaffected cards usable;
2. club switching cannot show stale data from the previous club;
3. role removal immediately removes protected actions;
4. event/RSVP/notification counts use the correct club and team scope;
5. destructive actions require explicit authorization and confirmation;
6. cache invalidation is targeted rather than global;
7. empty, loading and failed states are distinct.

## Media

`MediaPage.tsx` is a moderately suitable later target. It combines feed pagination, caching, Realtime, comments, reactions, reports, blocks, deletion, upload gating, views, filtering and Free/Pro usage. Supporting media/security utilities have tests, but the page lacks a cohesive orchestration suite.

Before refactoring, test:

- cross-club feed isolation;
- pagination deduplication and stable ordering;
- Realtime insert/delete reconciliation;
- delete/report/block permissions;
- Free usage and Pro gate failure behaviour;
- signed/private media failure boundaries;
- highlighted-photo navigation across unloaded pages;
- channel and observer cleanup.

Afterward, extract a media-feed repository/controller and leave cards/lightbox/upload presentation independent.

## ManageUsersPage

Although smaller at 1,931 lines, this page is app-admin critical. It performs role assignment/removal, bulk operations, deletion scheduling/immediate deletion, points awards, notifications, email and audit reads. It should not be selected for an early cosmetic split.

Required first: a full app-admin access test, role-scope tests, duplicate-click protection, partial bulk-failure reporting, deletion confirmation and audit recording tests. Backend authorization must remain authoritative.

## Recommended testing waves

### Wave 1 — Competition fixtures

Approximately 18–24 tests. This unlocks the safest first refactor.

### Wave 2 — Membership administration

Approximately 20–30 component/integration tests around `AddTeamMemberSheet`, plus only missing local database cases. This protects a high-security domain and creates reusable service boundaries.

### Wave 3 — Messaging controllers

Approximately 30–40 tests shared across inbox, group, team, club and DM adapters. Parameterize common contracts to avoid copying the same tests five times. Add two Playwright journeys: offline/retry and Realtime/jump/read lifecycle.

### Wave 4 — AutoSub/PitchBoard

Turn the agreed fairness contract into blocking cases and add one orchestrated game lifecycle. Do not broaden snapshot coverage.

### Wave 5 — Media and read-model pages

Add focused page orchestration tests, then extract repositories/read models.

### Wave 6 — Vault, Event Detail and app administration

Build dedicated safety harnesses before structural work due to permissions and multi-step mutations.

## Expected score impact

| Milestone | Estimated maintainability score |
|---|---:|
| Current audited baseline | **6.1/10** |
| Readiness analysis and characterization tests complete | **6.3–6.5/10** |
| Competition + membership boundaries refactored | **6.7–7.0/10** |
| Messaging controllers consolidated safely | **7.0–7.3/10** |
| AutoSub/PitchBoard domain boundaries completed | **7.2–7.5/10** |
| Plus clean type/lint ratchets and Edge Function governance | **7.6–8.0/10** |

These estimates assume behaviour remains stable and the extracted modules adopt typed boundaries. Moving JSX into more files without reducing data, permission and mutation coupling would not materially improve the score.

## Final recommendation

Keep `CompetitionFixturesPanel` as the first test-hardening bundle. Then prioritize `AddTeamMemberSheet` before Messages because membership is security-sensitive and its backend contracts are already well established. Begin the messaging programme only after shared page-level contract tests exist; it offers one of the largest maintainability gains but also one of the largest user-visible regression surfaces.
