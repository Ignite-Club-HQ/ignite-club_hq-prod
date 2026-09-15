# Refactoring Phase 1 — Competition fixtures pilot

Date: 2026-08-03
Branch: `codespaces-review`
Status: implementation complete on the cumulative integration branch; Playwright, isolated-local and one-click automated gates passed; delegated manual acceptance and promotion pending. See `REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`.

## Progress

- Slice 1A completed: feature-local fixture contracts, stable query-key
  factories, and fixture/linked-team read repositories extracted without
  changing query or cache behaviour.
- Slice 1A verification: 69 focused tests passed, extracted modules lint clean,
  and the production build completed successfully.
- Slice 1B completed: generated-fixture row construction, injected persistence,
  and user-safe persistence error classification extracted without changing
  confirmation, form, toast, reset or cache-invalidation behaviour.
- Slice 1B verification: 82 focused tests passed, extracted modules lint clean,
  and the production build completed successfully.
- Slice 1C completed: result/status derivation, match-detail payloads, ID-scoped
  update/delete operations and competition-scoped round trimming extracted
  without changing dialog, toast or invalidation behaviour.
- Slice 1C verification: 94 focused tests passed, including new successful and
  rejected round-trimming component boundaries; extracted modules lint clean
  and the production build completed successfully.
- Slice 1D completed: manual-match row construction/insertion, finals
  next-round discovery, finals row construction and finals insertion extracted
  without changing validation, form state, timestamps, pitch waves or notes.
- Slice 1D verification: 103 focused tests passed, extracted modules lint clean,
  and the production build completed successfully.
- Slice 1E completed: external-team collection, linked-club mapping, team/club
  options, combined filters, invalid-filter recovery, round grouping and round
  summaries extracted into a pure fixture-list model.
- Slice 1E verification: 114 focused tests passed, extracted modules lint clean,
  and the production build completed successfully.
- Slice 1F completed: the three-step ladder read, accepted-entry placeholders,
  team enrichment, visibility, filters, ordering and grouping extracted into a
  typed repository and pure model.
- Slice 1F verification: 126 focused tests and the isolated synthetic local
  competition lifecycle journey passed; extracted modules lint clean and the
  production build completed successfully.
- Slice 1G-a completed: ladder query ownership and its loading, failure, empty
  and populated presentation states moved behind a feature-local component
  while preserving the legacy public component contract.
- Slice 1G-a verification: all 126 focused competition tests passed, the new
  feature-local component is lint clean, and the production build completed
  successfully.
- Slice 1G-b completed: ladder visibility, division/team filter controls and
  grouped-standings presentation moved into the feature-local ladder component;
  the existing division table renderer and public export remain unchanged.
- Slice 1G-b verification: all 126 focused competition tests passed, the
  feature-local ladder modules are lint clean, and the production build
  completed successfully.
- Slice 1G-c completed: the division card, standings table, team avatar and
  complete feature-local ladder panel now own the active ladder presentation;
  the legacy export delegates to that feature component.
- Slice 1G-c verification: three direct ladder presentation cases were added;
  all 129 focused competition tests passed, feature-local ladder modules are
  lint clean, and the production build completed successfully.
- Slice 1G-d completed: the unreachable legacy ladder view, table, card and
  obsolete imports were removed after the feature-local implementation passed
  independently; the compatibility export remains in place.
- Slice 1G-d verification: TypeScript, all 129 focused competition tests,
  feature-local ladder lint and the production build completed successfully.
- Slice 1G-e completed: fixture-list filter state, linked-team query ownership,
  external-club mapping, option derivation, invalid-filter recovery, filtering,
  grouping and round summaries moved into a typed feature-local controller hook.
- Slice 1G-e verification: all 129 focused competition tests passed, the new
  controller is lint clean, and the production build completed successfully.
- Slice 1G-f completed: fixture filter controls, role-specific empty guidance,
  filtered-empty state, round summary and grouped-list shell moved into a
  feature-local component; mutation and match renderers remain injected.
- Slice 1G-f verification: three direct fixture-list presentation cases were
  added; all 132 focused competition tests passed, extracted modules are lint
  clean, TypeScript passed, and the production build completed successfully.
- Slice 1G-g completed: round collapse state, date-range summary, match counts
  and completion progress moved into a feature-local round component while the
  mutation-capable match row remains an injected renderer.
- Slice 1G-g verification: three direct round-presentation cases were added;
  all 135 focused competition tests passed, extracted modules are lint clean,
  TypeScript passed, and the production build completed successfully.
- Match-row pre-extraction hardening completed: four characterization cases
  now protect external/local source badges, status/schedule/venue presentation,
  the complete manual-fixture settings menu, competition-level PlayHQ gating,
  native context-menu suppression and moved-pointer gesture handling.
- Match-row hardening verification: all 139 focused competition tests passed;
  this boundary bundle changed tests and this progress record only.
- Slice 1G-h completed: the active match card, result edit/delete mutations,
  status/source/venue presentation, settings menu and touch guards moved into
  a typed feature-local component; the details editor remains injected.
- Slice 1G-h verification: all 139 focused competition tests passed, the new
  row component is lint clean, TypeScript passed, and the production build
  completed successfully.
- Slice 1G-i completed: match-details form state, validation, payload
  construction, persistence outcomes and dialog presentation moved into a
  typed feature-local component without changing its row integration.
- Slice 1G-i verification: all 139 focused competition tests passed, the new
  details component is lint clean, TypeScript passed, and the production build
  completed successfully.
- Slice 1G-j completed: finals-round form state, validation, next-round
  discovery, seed preview, persistence outcomes and reset behavior moved into
  a typed feature-local form component.
- Slice 1G-j verification: all 139 focused competition tests passed, the new
  finals component is lint clean, TypeScript passed, and the production build
  completed successfully.
- Slice 1G-k completed: manual-match mobile sheet, form state, validation,
  persistence outcomes, reset and close behavior moved into a typed
  feature-local component.
- Slice 1G-k verification: all 139 focused competition tests passed, the new
  manual-match component is lint clean, TypeScript passed, and the production
  build completed successfully.
- Slice 1G-l completed: maximum-round dialog state, trimming outcomes,
  guidance, error reporting and fixture invalidation moved into a typed
  feature-local mutation component.
- Slice 1G-l verification: all 139 focused competition tests passed, the new
  round-limit component is lint clean, TypeScript passed, and the production
  build completed successfully.
- Slice 1G-m completed: fixture generation state, schedule configuration,
  occupied-pitch reads, preview presentation, confirmation and persistence
  orchestration moved into a typed feature-local generator; the fixture list
  remains an injected render boundary.
- Slice 1G-m verification: all 139 focused competition tests passed, both the
  generator and compatibility composition module are lint clean, TypeScript
  passed, and the production build completed successfully.
- Phase 1 implementation status: all planned data, workflow, read-model and
  presentation boundaries are extracted. Promotion remains blocked until the
  final relevant Playwright, isolated local-Supabase and complete one-click
  baseline gates pass.
- The compatibility `CompetitionFixturesPanel.tsx` is now a 180-line typed
  composition module; the active feature behavior lives behind the extracted
  fixture and ladder boundaries.

## Objective

Use competition fixtures as the pilot for a repeatable, behaviour-preserving
feature architecture:

`UI -> controller/hook -> workflow/repository -> Supabase`

All implementation occurs in this Codespace on `codespaces-review`. Nothing is
implemented through Lovable or directly on `main`. Completed slices may be
offered back to `main` only after focused verification and the complete
one-click baseline pass, followed by explicit user approval.

## Starting shape

`src/components/CompetitionFixturesPanel.tsx` was 2,710 lines and originally owned:

1. fixture reads and React Query cache keys;
2. accepted-team and division selection;
3. round-robin and finals preview orchestration;
4. schedule configuration and occupied-pitch calculation;
5. generated-fixture row construction and bulk insertion;
6. fixture list filtering by division, team and linked PlayHQ club;
7. external-team lookup and club enrichment;
8. result/status updates and external-override metadata;
9. fixture deletion;
10. maximum-round updates;
11. full match-detail editing;
12. manual match creation;
13. finals-round creation and next-round discovery;
14. ladder, accepted-entry and team enrichment reads;
15. ladder placeholder construction, filtering and presentation;
16. all dialogs, sheets, cards, rows and responsive presentation.

The pure round-robin, scheduling, placement and finals algorithms are already
in `src/lib/competitionScheduler.ts` and have 19 focused tests. They should not
be rewritten during this pilot.

## Existing protection

The principal existing suites provide:

- 16 fixture-management characterization cases;
- 8 result-editing cases;
- 19 pure scheduler cases;
- 1 local-Supabase competition lifecycle journey;
- adjacent competition settings, creation, joining and CSV-import coverage.

Protected behaviour includes admin/PlayHQ gates, generation validation,
pairing preview, exact bulk inserts, deletion success/failure, edit validation,
manual-match validation, finals creation, score/status transitions, external
override metadata, cache invalidation and organiser/team database permissions.

## Material test gaps before extraction

Add characterization tests only for these demonstrated boundaries:

1. fixture read query failure versus a genuine empty competition;
2. exact fixture read ordering and competition scope;
3. linked PlayHQ-team lookup failure without corrupting the base fixture list;
4. ladder query, accepted-entry query and team-enrichment failure outcomes;
5. finals next-round lookup failure must not be silently treated as round one;
6. duplicate submission protection for generated fixtures and manual/finals
   creation where a request remains pending;
7. result/edit/delete workflows retain their exact targeted invalidations and
   remain retryable after failure.

These tests characterize current behaviour first. If current behaviour is
unsafe or misleading, stop and report the defect before changing it. A defect
fix must remain separate from structural extraction wherever practical.

## Phase 1 slices

### 1A — Contracts, query keys and fixture read repository

Introduce feature-local types for fixture rows, teams, divisions and entries,
plus stable query-key factories. Extract the exact competition-scoped fixture
read and linked-team lookup without changing select strings, ordering, error
semantics, enabled conditions or cache keys.

Proposed files:

- `src/features/competitions/fixtures/types.ts`
- `src/features/competitions/fixtures/queryKeys.ts`
- `src/features/competitions/fixtures/repository.ts`
- focused tests beside those modules
- minimal import/call-site changes in `CompetitionFixturesPanel.tsx`

Gate: existing fixture characterization tests plus the new read-boundary tests.

### 1B — Generated-fixture workflow

Extract deterministic input normalization, generated-row construction and
safe persistence error classification. Keep React state, confirmation dialogs,
toasts and reset UX in the component/controller. Inject the authenticated user
and repository operation explicitly.

Proposed files:

- `src/features/competitions/fixtures/generationWorkflow.ts`
- `src/features/competitions/fixtures/generationWorkflow.test.ts`

Gate: scheduler tests and all preview/generation characterization cases.

### 1C — Result, edit and delete workflows

Extract the mutation payload builders and one-operation workflows for result
updates, match-detail edits, maximum-round updates and deletion. Preserve:

- score-to-status transitions;
- external override timestamps;
- exact row targeting;
- failure messages and retryability;
- fixture and ladder invalidation boundaries.

Proposed files:

- `src/features/competitions/fixtures/matchWorkflows.ts`
- `src/features/competitions/fixtures/matchWorkflows.test.ts`

Gate: result and mutation characterization suites.

### 1D — Manual match and finals workflows

Extract manual-match payload construction, finals seed row construction and
next-round discovery. Keep form state and presentation outside the workflow.
Do not change validation, scheduling timestamps, pitch waves or notes.

Proposed files:

- `src/features/competitions/fixtures/manualMatchWorkflow.ts`
- `src/features/competitions/fixtures/finalsWorkflow.ts`
- focused tests for both

Gate: manual-match/finals characterization and scheduler finals tests.

### 1E — Fixture list read model

Extract pure derivation of team options, linked-club options, filtered matches,
round grouping and invalid-filter recovery. This module receives data and
returns typed view models; it performs no Supabase or React operations.

Proposed files:

- `src/features/competitions/fixtures/fixtureListModel.ts`
- `src/features/competitions/fixtures/fixtureListModel.test.ts`

Gate: pure table-driven filter tests plus existing component rendering tests.

### 1F — Ladder repository and read model

Extract the three-step ladder read (ladder rows, accepted entries, team
enrichment) and pure placeholder/ordering/grouping logic. Preserve division
visibility, zero-row placeholders and overall/division display semantics.

Proposed files:

- `src/features/competitions/ladder/types.ts`
- `src/features/competitions/ladder/repository.ts`
- `src/features/competitions/ladder/ladderModel.ts`
- focused repository and model tests

Gate: ladder failure/empty/population tests and local competition lifecycle.

### 1G — Presentation split and final controller cleanup

Only after data and workflow boundaries are stable, move presentational
sections into feature-local components. Avoid a generic component controlled by
large boolean prop sets. Keep explicit components for generator, list, match
row/editor, manual match, finals and ladder.

Possible files:

- `FixtureGenerator.tsx`
- `FixtureList.tsx`
- `FixtureMatchRow.tsx`
- `FixtureEditor.tsx`
- `ManualMatchForm.tsx`
- `FinalsRoundForm.tsx`
- `CompetitionLadder.tsx`

Gate: all competition component tests and relevant Playwright journeys.

## Explicit non-goals

- no UI redesign;
- no schema, migration, RLS or Edge Function changes;
- no change to competition permissions;
- no scheduler algorithm rewrite;
- no new global Supabase/database service;
- no repository-wide query-key migration;
- no conversion of unrelated `any` types in one sweep;
- no changes to PlayHQ synchronization semantics;
- no opportunistic feature work.

## Per-slice verification and promotion

For every slice:

1. begin from a clean `codespaces-review` worktree synchronized with approved
   `main`;
2. record the exact files and public contracts in scope;
3. run the focused pre-change tests;
4. implement only the stated extraction;
5. run focused tests and type/build checks;
6. inspect the diff for behaviour, query, cache, permission and dependency
   changes;
7. commit the slice separately on `codespaces-review`;
8. after all Phase 1 slices, run relevant Playwright and local-Supabase tests;
9. run the complete one-click baseline;
10. push for review with results and rollback instructions;
11. merge to `main` only after explicit user approval.

Rollback is per slice: revert that slice's dedicated commit. Tests must never be
weakened to accommodate an unintended behavioural change.

## Recommended immediate action

Begin Phase 1 test hardening for the seven material gaps above. Do not alter
production code during that bundle. Once those tests are reviewed and green—or
have exposed and documented genuine defects—start slice 1A only.
