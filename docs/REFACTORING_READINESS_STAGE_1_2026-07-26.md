# Ignite Club HQ — Refactoring Readiness Stage 1

**Date:** 26 July 2026
**Scope:** Analysis only. No production refactoring was performed.
**Candidates:** `CompetitionFixturesPanel.tsx`, `EventDetailPage.tsx`, and `VaultPage.tsx`.

## Outcome

`CompetitionFixturesPanel.tsx` is the safest first refactoring target, but it needs a bounded characterization suite around fixture CRUD and generation before extraction begins. `EventDetailPage.tsx` and `VaultPage.tsx` offer greater eventual maintainability benefit but are not ready for structural change because page-level orchestration is insufficiently characterized.

| Rank | Candidate | Size | Data/mutation indicators | Current readiness | Recommendation |
|---:|---|---:|---|---:|---|
| 1 | `CompetitionFixturesPanel.tsx` | 2,701 lines | 24 table calls, 3 queries, 79 state hooks | **7.0/10** | Add focused characterization tests, then refactor |
| 2 | `EventDetailPage.tsx` | 4,242 lines | 108 table calls, 6 RPCs, 19 mutations, 29 queries | **4.0/10** | Characterize mutation orchestration before considering extraction |
| 3 | `VaultPage.tsx` | 5,708 lines | 67 table calls, 6 function calls, 15 mutations, 16 queries | **3.5/10** | Build a dedicated page/service test harness; defer refactoring |

The counts are change-risk indicators, not measures of code quality by themselves.

## Candidate 1 — Competition fixtures

### Responsibilities currently combined

- round-robin pairing and schedule preview configuration;
- scheduling-window, pitch, weekday, frequency and overflow handling;
- existing-pitch occupancy calculation;
- finals generation and placement;
- bulk fixture insertion;
- fixture filters and grouping;
- match score/status updates;
- external-source override handling;
- match detail editing and deletion;
- manual match and finals creation;
- maximum-round management;
- ladder reads, grouping and rendering;
- permissions and PlayHQ/local action visibility;
- query invalidation and user feedback.

### Existing protection

- `competitionScheduler.test.ts`: 19 pure scheduling tests covering pairings, odd team counts, occupied pitches, waves, overflow, end dates, date overrides, time windows and finals placement.
- `CompetitionFixturesPanel.results.test.tsx`: 8 component tests covering score entry, clearing scores, status transitions, external overrides, permission visibility and rejected updates.
- Competition settings, join and creation component tests.
- One isolated local-Supabase competition lifecycle journey.

### Primary missing characterization tests

1. Admin fixture-generation journey from configuration through exact insert payload.
2. Non-admin cannot see or trigger generate, add, edit, delete, finals or maximum-round controls.
3. PlayHQ-managed competition cannot perform prohibited local mutations.
4. Generation validation: venue, accepted-team count, invalid time window, and no-fitting-fixtures outcome.
5. Overflow and extra-wave confirmation: cancellation performs no insert; confirmation inserts once.
6. Duplicate, permission and network insert failures produce correct safe feedback and do not invalidate caches.
7. Successful bulk creation invalidates fixtures exactly once and resets dialog state.
8. Match-details editing: exact nullable payload, validation, failure handling and cache invalidation.
9. Match deletion: confirmation, success, rejection and duplicate-click protection.
10. Manual fixture creation rejects same-team fixtures and invalid/incomplete inputs.
11. Finals creation preserves seed placeholders, round number, date, pitch and notes.
12. Maximum-round update success and failure behaviour.
13. Ladder query failure does not misrepresent an empty ladder as a successful result.
14. Read-query failures are surfaced rather than silently converted into empty successful data.

### Natural extraction boundaries after tests are green

1. Pure preview/view-model construction around the already extracted scheduler.
2. Fixture permission/action policy functions.
3. Typed `competitionFixturesRepository` for reads and single-operation writes.
4. Fixture mutation orchestration and cache invalidation hooks.
5. Generate, match-detail, manual-match and finals dialogs.
6. Fixture list and ladder presentation.

The public `CompetitionFixturesPanel` and `CompetitionLadderPanel` props should remain unchanged during the first extraction sequence.

## Candidate 2 — Event detail

### Responsibilities currently combined

- event, RSVP, guest, duty, role, subscription and payment queries;
- team, club, mini-league and targeted-event roster resolution;
- guardian and child attendance mapping;
- permission and Pro-entitlement decisions;
- self, child, guardian and admin RSVP changes;
- payment checkout/status handling;
- duty creation, claiming, completion, assignment and notifications;
- event deletion and recurring-series deletion;
- event cancellation, chat posts and recipient notifications;
- reminder and invitation resend fan-out;
- match captain, goalkeeper and player-of-match workflows;
- pitch-board launch and game-state integration;
- sharing, ICS export, navigation and presentation.

### Existing protection

The surrounding domain has strong tests for attendance rendering, RSVP audience rules, RSVP queues, event grouping, targeted club events, recurring cancellation dialogs, reminders, event membership, payment helpers and local-Supabase event journeys. However, there is no cohesive `EventDetailPage` characterization suite proving how these behaviours are orchestrated together.

### Primary missing characterization tests

1. Page-level access matrix for ordinary member, guardian, coach, team admin, committee member, club admin and app admin.
2. Correct query enablement and scope for team, club-wide, targeted-team and mini-league events.
3. RSVP orchestration for adult, child, shared guardians and admin overrides.
4. Mutation failure preserves the previous RSVP UI and permits retry.
5. Duty create/claim/complete/assign workflows, including notification failure boundaries.
6. Single-event versus recurring-series cancellation/deletion exact database operations.
7. Partial failure during recurring update/delete/cancel must not report complete success.
8. Cancellation chat-post and notification idempotency.
9. Reminder and resend recipient deduplication across roles, guardians and teams.
10. Targeted-event roster never includes untargeted teams.
11. Payment checkout initiation, status listener cleanup and failure recovery.
12. Pitch-board action visibility and safe launch gating.
13. Query errors must not be represented as valid empty attendance, duty or payment states.
14. Duplicate-click protection for destructive and fan-out actions.

### Readiness decision

Do not refactor this page yet. First create a reusable Supabase query harness and page-level characterization tests for cancellation, RSVP and duty workflows. Extracting JSX before mutation boundaries are protected would increase risk without reducing the hardest coupling.

## Candidate 3 — Vault

### Responsibilities currently combined

- role, club, team, mini-league and Pro-entitlement resolution;
- folder navigation, hierarchy, search and filtering;
- photos, files, links and Google Drive imports;
- upload, rename, move, soft delete, restore and permanent deletion;
- trash and bulk deletion;
- storage usage, quotas and upgrade prompts;
- signed URLs, downloads, native file handling and sharing;
- recursive exports and ZIP construction;
- selection state and large-file management;
- permissions for club, team, mini-league and uploader contexts;
- extensive dialogs, sheets, thumbnails and content rendering.

### Existing protection

- Local-Supabase storage permission and edge-case suites.
- Signed URL and safe file-opening tests.
- Native photo picker, media cache and selected vault-related hook tests.
- No dedicated `VaultPage` component/orchestration test was found.

### Primary missing characterization tests

1. Complete view/access matrix for app admin, club admin, committee member, team admin, coach, member and unauthorized user.
2. Folder/file/photo query scope for root, club, team, mini-league and nested-folder views.
3. Upload permission and quota boundary, including exact-byte limit behaviour.
4. Upload compensation: storage object must be cleaned up if metadata insertion fails.
5. Metadata must not be inserted when storage upload fails.
6. Rename and move permission failures preserve visible state and allow retry.
7. Soft delete, restore and permanent deletion success/failure boundaries.
8. Bulk delete handles partial failures without falsely reporting complete success.
9. Empty-trash duplicate-click and partial-failure protection.
10. Export respects selection, excluded folders, permission scope and signed URL failures.
11. Search does not leak inaccessible folder or file metadata.
12. Pro and storage checks fail closed when entitlement queries fail.
13. Google Drive OAuth/import state validation and failure recovery.
14. Query errors are distinguishable from legitimate empty folders.
15. Hosted storage URL construction is configuration-driven and environment-safe.

### Risk observations requiring verification, not immediate fixes

- The page contains a hard-coded hosted Supabase origin in both upload paths. This may create environment coupling and should be characterized before replacement.
- Several workflows combine storage operations, metadata writes and cache invalidation without a single transaction. Compensation behaviour must be tested before extraction.
- The page uses numerous `any` values across permission-sensitive objects, increasing refactoring risk.

### Readiness decision

Defer structural refactoring until a Vault-specific test harness covers permissions, upload compensation, deletion and quota behaviour. Once protected, extract permission/quota policies first, then storage/repository operations, and only then split presentation.

## Recommended test-hardening order

### Bundle A — Competition refactoring gate

Add approximately 18–24 focused tests covering fixture generation, mutation failures, permission visibility, CRUD, finals and cache invalidation. Prefer component integration tests with a realistic Supabase chain harness plus existing pure scheduler tests. Add a Playwright journey only if fixture administration is a frequent critical user workflow.

### Bundle B — Event-detail mutation gate

Add approximately 20–30 tests, initially focused on cancellation/deletion, RSVP orchestration and duty workflows. Reuse existing domain tests and avoid duplicating every rendering permutation.

### Bundle C — Vault safety gate

Add approximately 20–30 tests for access, uploads, compensation, quota, move/delete/restore and bulk operations. Extend local-Supabase coverage only where RLS or storage policy behaviour is not already represented.

## Refactoring entry criteria

A candidate is ready only when:

- critical success, permission, validation and failure behaviours are characterized;
- no test relies solely on snapshots or internal implementation details;
- multi-step operations have explicit partial-failure expectations;
- existing and new focused tests pass;
- the complete one-click baseline passes;
- extraction boundaries and rollback are documented;
- the first refactor changes structure only, not behaviour.

## Stage 1 recommendation

Proceed next with **Bundle A for `CompetitionFixturesPanel`**. Do not modify production code while creating the tests. After Bundle A is green, reassess readiness and present the first proposed extraction as a separate approval decision.
