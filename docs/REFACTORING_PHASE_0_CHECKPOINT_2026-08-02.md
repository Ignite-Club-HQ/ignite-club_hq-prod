# Refactoring Phase 0 checkpoint

Date: 2026-08-02
Branch: `codespaces-review`

## Purpose

Phase 0 establishes a reproducible, reviewable checkpoint before structural
refactoring begins. It does not change application behaviour, database schema,
query ownership, or deployment configuration.

## Safety boundary

- Hosted development and production Supabase projects are out of scope.
- No hosted credentials or remote database URLs may be used.
- Database-backed baseline tests may use only the repository's isolated local
  Docker Supabase workspace and synthetic fixtures.
- Existing production changes in the worktree must not be silently mixed into a
  refactoring commit.

## Current baseline

- Complete Phase 0 baseline run on 2026-08-02: 3,607 passing tests
  - Frontend: 3,300 passed, 3 intentional skips
  - Playwright: 96 passed
  - Local Supabase: 211 passed
  - Isolated local Supabase cleanup: passed; no test containers or data
    volumes remained
- Phase 0 affected-suite verification on 2026-08-02:
  - 19 test files passed
  - 147 tests passed
  - 1 dependency-candidate test skipped intentionally
- Known test-output noise: one React `act(...)` warning in the authenticated
  `AppLayout` routing test. This is not a behaviour failure, but should be
  removed before warning-free output becomes a CI gate.

## Worktree classification

The worktree was not clean when Phase 0 began. It contains three distinct
categories that must remain separately reviewable.

### Test and harness changes

- Messaging navigation/layout Playwright coverage
- Router, notification launch, offline, legal reacceptance, pitch-board and
  autosub tests
- Edge Function recipient-isolation tests
- Dependency-upgrade safety tests
- Playwright configuration changes

### Production/backend changes already paired with regression coverage

- Mini-league autosub planner export for direct behavioural testing
- Pitch-board resume timer cleanup
- Realtime telemetry sample bounding and user-scoped read-receipt subscription
- Pending-sub recipient policy extraction
- Capacity telemetry migration

These are pre-existing changes, not Phase 0 refactoring. Their intent and tests
must be reviewed and committed independently or deliberately excluded before
the first refactor.

### Documentation and generated metadata

- Vendor-readiness and refactoring-readiness assessments
- Capacity/observability documentation
- `deno.lock`

Generated metadata must be checked for reproducibility and ownership before it
is committed.

## Refactoring entry gates

Phase 1 may begin only when all of the following are true:

1. The complete one-click baseline passes from a fresh isolated local stack.
   **Satisfied on 2026-08-02.**
2. The local stack shuts down successfully after the run.
   **Satisfied on 2026-08-02.**
3. Every modified production/backend file is either committed with its focused
   regression tests or intentionally removed from the refactoring checkpoint.
4. Test-only, documentation, production, and generated-file changes are split
   into reviewable commits.
5. The branch is pushed and the checkpoint commit identifiers are recorded.
6. No hosted Supabase environment was contacted.

## Refactoring safety gates

For every later refactoring slice:

1. Preserve external behaviour and public contracts.
2. Add characterization tests only for a demonstrated gap.
3. Move one responsibility or query boundary at a time.
4. Run the focused tests after each slice.
5. Run the complete baseline before merging the slice.
6. Compare observable outputs, authorization failures, cache invalidation,
   realtime cleanup, and retry/idempotency behaviour.
7. Revert the isolated slice if behaviour changes unexpectedly; do not weaken
   assertions to make the refactor pass.

## Phase 1 candidate

Use competition fixtures as the pilot domain. It is smaller and more bounded
than messaging, events, vault, or pitch-board orchestration, while still
exercising read models, mutations, permissions, cache invalidation, and
multi-step Supabase behaviour.

The intended dependency direction is:

`UI component -> feature controller/hook -> repository or workflow -> Supabase`

Do not introduce a global database service or attempt repository-wide query
decoupling in one change.
