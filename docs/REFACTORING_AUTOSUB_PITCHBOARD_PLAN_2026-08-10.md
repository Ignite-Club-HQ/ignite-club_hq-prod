# AutoSub and PitchBoard refactoring plan

**Established:** 10 August 2026
**Development branch:** `codespaces-review`
**Status:** AP0–AP7 complete on the cumulative integration branch; automated closeout passed; delegated manual acceptance and promotion pending. See `REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`.

## Objective

Reduce the cost and risk of maintaining AutoSub and PitchBoard while preserving
game-time calculations, Standard versus Frequent mode behaviour, goalkeeper
constraints, manual substitutions, persistence, notifications and timer
recovery. Refactoring remains on `codespaces-review` until focused and complete
baseline verification passes and promotion is explicitly approved.

## Current shape

- `AutoSubPlanDialog.tsx`: 5,585 lines. It contains planner calculations,
  constraint enforcement, fairness diagnostics, fix suggestions, controls and
  dialog presentation.
- `PitchBoard.tsx`: 3,419 lines. It coordinates game state, timer, formation,
  lineup, substitutions, persistence, event links and layouts.
- Planner support already exists under `pitch/planner` and `pitch/autoSub`, and
  PitchBoard already delegates several responsibilities to focused hooks.
- The safe dependency direction is:
  `UI -> controller/hook -> pure planner/workflow -> typed domain values`.

## AP0 pre-refactor baseline

Focused verification on 10 August 2026:

- 13 files passed.
- 208 tests passed.
- Standard/Frequent hard mode contracts passed.
- Plan repair, reducer, selectors, execution, goalkeeper rotation, window and
  equal-time tests passed.
- The complete one-click baseline immediately before AP0 passed 4,458 frontend
  tests, 138 Playwright journeys and 258 isolated local-Supabase tests. Cleanup
  passed.

### Existing fairness debt — AP-D1

The broad 96-case diagnostic sweep reports 9 rotation-pool spread breaches.
Every breach is Standard mode (`rotationSpeed=1`) with halftime goalkeeper
rotation enabled. The selected cap is five minutes; observed spreads range from
5.5 to 9 minutes. The worst case is 7-a-side, four bench players and 30-minute
halves, at a nine-minute spread.

This is not a refactoring regression. The diagnostic is intentionally soft and
the representative blocking mode contracts pass. AP-D1 must not be silently
fixed or encoded as desirable behaviour during structural extraction. Any
fairness algorithm change must be a separate product change with before/after
simulation evidence and explicit approval.

Full-squad spread involving a goalkeeper deliberately locked for a complete
match is informational rather than planner-controllable. It must remain
separate from rotation-pool fairness.

## Refactoring slices

### AP1 — Pure calculation primitives

- Move time forecasting, fairness-report calculation, player-position
  inference and rotation-speed normalization into framework-independent files.
- Preserve exported signatures and exact numeric outputs.
- Leave plan selection and all React presentation in the dialog.
- Add direct equivalence and edge-case contracts before deleting inline code.

**Completed locally 10 August 2026:**

- Extracted time forecasts, fairness reporting, position inference and legacy
  rotation-speed normalization into `pitch/planner/analysis.ts`.
- Preserved the dialog's public `calculateTimeForecasts` and
  `normalizeRotationSpeed` exports for existing consumers.
- Reduced `AutoSubPlanDialog.tsx` from 5,585 to 5,359 lines without changing
  planner selection or generated substitution plans.
- Added seven direct contracts covering both public modes, legacy mode values,
  position inference, elapsed/executed/skipped events, goalkeeper roles and
  exact stint/fairness results.
- Focused verification passes 215/215 tests across 14 files. TypeScript,
  targeted lint and the production build pass. The AP-D1 diagnostic remains
  exactly 9/96 soft breaches, confirming this extraction did not alter planner
  fairness output.

### AP2 — Standard-mode planner boundary

- Extract Standard-mode constants, window compaction, calm-down selection and
  no-starvation enforcement behind one typed planner boundary.
- Preserve the defining contract: Standard uses fewer substitution windows and
  no more player movements than Frequent while avoiding starvation.
- Characterize the 9 AP-D1 cases rather than changing their output.

**AP2a completed locally 10 August 2026:**

- Extracted absolute match-time mapping, whistle-window counting, ordered
  calm-down cadence candidates and adjacent-window compaction into
  `pitch/planner/standardMode.ts`.
- Kept playability and fairness policies injected by the existing planner, so
  the cadence module cannot silently redefine goalkeeper, position or spread
  rules.
- Added six direct contracts for halftime time mapping, batched-window counts,
  calm-down order, immutable best-merge selection, halftime protection and
  rejection of unplayable/over-cap candidates.
- Reduced `AutoSubPlanDialog.tsx` from 5,359 to 5,267 lines. Focused verification
  passes 221/221 tests across 15 files; TypeScript, targeted lint and production
  build pass. AP-D1 remains exactly 9/96 soft breaches.

**AP2b completed locally 10 August 2026:**

- Extracted the final no-starvation rewire/injection safeguard and effective
  Standard/Frequent threshold resolution into `planner/standardMode.ts`.
- Preserved the legacy in-place plan mutation, deterministic victim ordering,
  injury and goalkeeper-only exclusions, position compatibility, bounded
  rescue passes and chronological result ordering.
- Added four threshold/rescue contracts, bringing the Standard-mode module to
  ten direct tests. Focused verification passes 225/225 tests across 15 files;
  TypeScript, targeted lint and production build pass.
- `AutoSubPlanDialog.tsx` is now 5,068 lines, down 517 lines from its 5,585-line
  AP0 baseline. AP-D1 remains exactly 9/96 soft breaches, and Standard/Frequent
  mode contracts remain unchanged.

### AP3 — Frequent/equal-time planner boundary

- Consolidate equal-time candidate generation, spread selection and constraint
  validation behind the planner boundary.
- Preserve goalkeeper eligibility, position constraints, minimum shift,
  halftime and deterministic ordering.
- Keep advanced overrides explicit and typed.

**Completed locally 10 August 2026:**

- Extracted banked-minute totals, controllable-player selection, spread
  measurement and equal-time candidate selection into
  `pitch/planner/equalTimeOverride.ts`.
- Preserved kickoff-only eligibility, coach-priority opt-out, no-bench opt-out,
  Standard/Frequent cadence separation, goalkeeper inputs, calmest-first
  selection and the established rule that a strictly fairer candidate may be
  adopted even when the selected cap is not fully achievable.
- Added five direct contracts for banked totals, locked/injured exclusions,
  controllable spread, override eligibility and deterministic improvement.
- Focused verification passes 230/230 tests across 16 files; TypeScript,
  targeted lint and production build pass. AP-D1 remains exactly 9/96 soft
  breaches and the blocking mode contracts remain green.
- `AutoSubPlanDialog.tsx` is now 4,849 lines, down 736 lines (13.2%) from AP0.

### AP4 — Plan validation, diagnostics and repair

- Separate playable-plan validation, fairness diagnostics, proposed fixes and
  plan repair from dialog rendering.
- Preserve repair idempotency and chronological ordering after manual changes,
  unavailable players and fill-ins.
- Do not make the diagnostic sweep blocking until AP-D1 is separately resolved
  or an explicit accepted tolerance matrix is agreed.

**AP4a completed locally 10 August 2026:**

- Extracted remaining-plan playability validation into
  `pitch/planner/validation.ts`, preserving chronological half ordering,
  current lineup transitions and the rule that completed/skipped events do not
  invalidate the remaining plan.
- Extracted fairness-summary calculations and coach-facing diagnostic selection
  into `pitch/planner/diagnostics.ts`; the dialog retains presentation only.
- Added 13 direct behavior contracts for missing squad members, invalid lineup
  transitions, completed/skipped events, cross-half ordering, goalkeeper
  exclusion/rotation, target and spread calculations, mathematical floors and
  the Standard/Frequent constraint guidance shown to coaches.
- Focused verification passes 243/243 tests across 18 files. TypeScript, lint
  for every extracted planner module/test and the production build pass. The
  dialog's two pre-existing lint errors remain outside this extraction.
- `AutoSubPlanDialog.tsx` is now 4,788 lines, down 797 lines (14.3%) from AP0.
  AP-D1 remains exactly 9/96 soft breaches; no planner output changed.
- Existing-plan admission and repair integration remained for AP4b/AP4c.

**AP4b fix-selection investigation completed locally 10 August 2026:**

- Initially isolated the fix-selection code to characterize its behavior.
  AP5 reference tracing then proved the suggestion panel, recommendation
  wrappers and apply state had no render or call sites. AP5b removed this dead
  feature rather than retaining an unused abstraction and unused tests.
- Live advanced override defaults and ranges remain centralized in
  `pitch/planner/advancedOverrides.ts`.

**AP4c existing-plan/repair admission completed locally 10 August 2026:**

- Confirmed the mutation-heavy composition and injury repair engine was already
  isolated in `pitch/autoSub/repairPlan.ts` and protected by 14 direct tests;
  no duplicate repair implementation was introduced into the planner layer.
- Extracted the dialog's stale-plan admission rule into
  `pitch/planner/existingPlan.ts`: forecast mode rejects stale remaining plans
  so regeneration can run, while edit mode retains them for the established
  repair workflow. Completed/skipped history is never revived.
- Added seven contracts for absent/completed plans, removed players, manual
  lineup drift, edit repair, playable identity preservation and invalid past
  history alongside valid future work.
- Focused verification passes 262/262 tests across 20 files. TypeScript,
  extracted-module lint and production build pass. AP-D1 remains unchanged at
  9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 4,625 lines, down 960 lines (17.2%) from AP0.
  AP4 is complete; the next planned boundary is AP5 presentation extraction.

### AP5 — AutoSub dialog presentation

- Split advanced settings, diagnostics, impact preview, player rows and fix
  suggestions into typed database-free components.
- Keep planner invocation and dialog lifecycle in one thin controller.
- Preserve accessibility, mobile scrolling, controls and labels.

**AP5a completed locally 10 August 2026:**

- Extracted the live, database-free plan summary into
  `pitch/AutoSubPlanStatusCard.tsx`; planner state and calculations remain in
  the dialog/controller boundary.
- Removed the unreachable legacy `FairnessDiagnostics` JSX block after tracing
  all references and confirming the live forecast uses the compact status card.
  Its pure fairness diagnostic calculation remains independently tested.
- Added six UI contracts for exact displayed totals and rounding, the existing
  six-minute threshold, short-turn warnings and halftime-clash warnings.
- Focused verification passes 268/268 tests across 21 files. TypeScript,
  extracted-module/component lint and production build pass; AP-D1 remains
  exactly 9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 4,490 lines, down 1,095 lines (19.6%) from AP0.

**AP5b completed locally 10 August 2026:**

- Traced the coach-facing plan-fix suggestion panel end to end and confirmed it
  had no JSX call site. Its recommendation wrappers, apply handler and active
  state were likewise unreachable.
- Removed that dead presentation and behavior instead of extracting it. Kept
  the live advanced settings, player-priority ordering, mode controls and
  persistence unchanged, with defaults/ranges moved to
  `pitch/planner/advancedOverrides.ts`.
- Removed 12 tests that exercised only the unreachable helper module; no live
  production-behavior coverage was reduced.
- Focused verification passes 256/256 live-behavior tests across 20 files.
  TypeScript, extracted-module/component lint and production build pass; AP-D1
  remains exactly 9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 4,365 lines, down 1,220 lines (21.8%) from AP0.

**AP5c completed locally 10 August 2026:**

- Reference tracing found two further unreachable presentation blocks:
  `PlayersNeedingAttention` and the before/after `PlanImpactPreview`, plus its
  orphaned baseline ref. Removed them without changing the live forecast.
- Extracted the live Standard/Frequent selector into the database-free
  `pitch/AutoSubPlanModeToggle.tsx` component.
- Added five UI contracts covering both public mode descriptions, active-state
  accessibility, mode selection, unavailable-mode blocking/explanation and
  externally managed read-only settings.
- Focused verification passes 261/261 tests across 21 files. TypeScript,
  extracted-module/component lint and production build pass; AP-D1 remains
  exactly 9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 4,012 lines, down 1,573 lines (28.2%) from AP0.

**AP5d completed locally 10 August 2026:**

- Extracted the live draggable player forecast row into the database-free
  `pitch/AutoSubPlayerMinutesRow.tsx` component while preserving the existing
  DnD context and priority-order controller in the dialog.
- Added seven UI contracts for player identity/number fallback, starter and
  bench status, full/first-half/second-half goalkeeper roles, exact projected
  minutes, short-shift and bounce-back warnings, and locked versus accessible
  draggable rows.
- Focused verification passes 268/268 tests across 22 files. TypeScript,
  extracted-module/component lint and production build pass; AP-D1 remains
  exactly 9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 3,924 lines, down 1,661 lines (29.7%) from AP0.

**AP5e completed locally 10 August 2026:**

- Confirmed `FairnessSimulatorPanel` had no render site and its run handler was
  unreachable. Removed the panel, timer-like simulation state, reset effect,
  handler and simulator-only icon dependencies.
- Preserved the live automatic fairness summary and all planner calculations.
  Player rows continue accepting an independently supplied fairness report,
  but the dialog now explicitly supplies `null`, matching its prior runtime
  behavior where the unreachable handler could never populate the report.
- Focused verification remains 268/268 tests across 22 files. TypeScript,
  extracted-module/component lint and production build pass; AP-D1 remains
  exactly 9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 3,774 lines, down 1,811 lines (32.4%) from AP0.
  The live expert-controls extraction is the final planned AP5 slice.

**AP5f completed locally 10 August 2026:**

- Extracted the live expert controls and numeric slider presentation into
  `pitch/AutoSubAdvancedSettingsPanel.tsx`, with the override contract shared
  from `pitch/planner/advancedOverrides.ts`.
- Kept dialog ownership of persistence, open state and externally supplied
  overrides. Added accessible slider/reset labels without changing planner
  values, ranges, steps or mutation semantics.
- Added six UI contracts for collapsed/open behavior, all six established
  defaults, merged changes, individual reset, custom count/reset-all and fully
  read-only externally managed controls.
- Focused verification passes 274/274 tests across 23 files. TypeScript,
  extracted-module/component lint and production build pass; AP-D1 remains
  exactly 9/96 soft breaches.
- `AutoSubPlanDialog.tsx` is now 3,525 lines, down 2,060 lines (36.9%) from AP0.
  AP5 is complete. Further dialog extraction is optional and not recommended
  before the AP6 PitchBoard orchestration audit.

### AP6 — PitchBoard orchestration

- Only after AP1–AP5 are stable, continue extracting bounded hooks from
  `PitchBoard.tsx` for game lifecycle, planned-sub execution and notification
  coordination.
- Do not combine timer persistence, server concurrency, formation changes or
  notification-recipient changes in one slice.
- Preserve all team and mini-league entry points and resume restoration.

**AP6 orchestration audit completed locally 10 August 2026:**

- `PitchBoard.tsx` began AP6 at 3,419 lines, but already delegates timer,
  persistence, lifecycle, player bootstrap, plan repair, manual substitutions,
  fill-ins, formation-dialog state, lineup, drawing, ball, drag/drop, tactical
  mode and event linking to bounded hooks.
- The highest-value remaining boundary is the live formation/team-size
  notification workflow: recipient discovery, mini-league duty rules, message
  construction and RPC invocation remain embedded in the UI without direct
  service-level contracts. This is the recommended AP6b extraction.
- The next boundary is halftime orchestration: reconcile suppression,
  acknowledgement, planned halftime substitutions, fallback goalkeeper swap,
  sound and dialog state are still combined in one callback. This should be
  split only after behavior-decision contracts exist.
- Game unlink/reset orchestration remains medium priority because it coordinates
  timer, local persistence, `active_games`, query invalidation and UI state.
- The very large layout-context value is a handover cost, but splitting it now
  would create high mechanical churn with little behavior benefit. Defer it
  until the higher-risk side-effect workflows are isolated.
- Preserve strict separation between notification, timer, persistence and
  roster changes; do not refactor two of these boundaries in one slice.

**AP6a completed locally 10 August 2026:**

- Removed an unused direct `notifications` insert callback and the notification
  preference hook subscription that existed only to support it. Reference
  tracing confirmed there were no callers.
- Did not alter the live formation-change RPC, planned-sub alerts, recipient
  rules or any notification Edge Function/database behavior.
- PitchBoard-focused verification passes 58/58 tests across eight files,
  including orchestration simulation, timer, lifecycle, persistence, manual
  substitution, fill-in, event-link and formation-dialog coverage. TypeScript
  and the production build pass.
- `PitchBoard.tsx` is now 3,396 lines. AP6b should extract and characterize the
  live formation/team-size notification service before any behavior change.

**AP6b completed locally 10 August 2026:**

- Extracted formation/team-size notification coordination into
  `pitch/hooks/usePitchBoardFormationNotifications.ts`, separating recipient
  discovery and RPC delivery from the PitchBoard UI controller.
- Preserved the existing `user_roles`, `duties` and `event_group_duties`
  queries, role/duty filters, current-user inclusion, recipient deduplication,
  message format and `notify_formation_change` RPC arguments. No schema, RLS,
  Edge Function or backend contract changed.
- Added eight direct contracts covering concise and detailed message text,
  missing-user/read-only/finished suppression, regular-team staff and Subs
  Manager discovery, mini-league Referee/Subs Manager discovery, duplicate
  removal and non-fatal RPC errors.
- PitchBoard-focused verification passes 84/84 tests across ten files.
  TypeScript, extracted-hook lint and the production build pass.
- `PitchBoard.tsx` is now 3,299 lines, down 120 lines (3.5%) during AP6. The
  next recommended boundary is AP6c: characterize the halftime decision tree
  before extracting its orchestration. Do not combine that work with timer or
  persistence changes.

**AP6c completed locally 10 August 2026:**

- Extracted the PitchBoard-level halftime coordinator into
  `pitch/hooks/usePitchBoardHalftimeOrchestration.ts`. The AutoSub scheduler
  continues to own planned and stale first-half substitutions; this hook owns
  only the ordering around suppression, delegation, preferred-goalkeeper
  fallback and the live informational prompt.
- Preserved the established 30-second stale-resume cutoff, acknowledgement
  guard, 500 ms safety delay, timer-boundary recheck, goalkeeper event shape,
  sounds and setter ordering. Timer persistence and scheduler implementation
  were not changed.
- Added eight contracts covering goalkeeper eligibility, planned-sub priority,
  stale/acknowledged suppression, exact goalkeeper swap construction,
  reconcile versus live behavior, cancellation after second-half play begins
  and first-half no-op behavior.
- PitchBoard-focused verification passes 92/92 tests across eleven files.
  TypeScript, extracted-hook lint and the production build pass.
- `PitchBoard.tsx` is now 3,255 lines, down 164 lines (4.8%) during AP6. The
  next candidate is the medium-priority unlink/reset transaction. Audit and
  characterize it before deciding whether extraction materially improves
  handover; avoid splitting the layout context solely to reduce line count.

**AP6d completed locally 10 August 2026:**

- Audited reset and unlink as separate transactions, then extracted only event
  unlinking into `pitch/hooks/usePitchBoardUnlinkEvent.ts`. Reset behavior was
  deliberately left untouched for its own characterization slice.
- Preserved immediate UI unlinking, the complete local board snapshot,
  regular-team-only `active_games` deactivation scoped to the current team and
  user, cache invalidation and the existing success confirmation behavior.
- Added six direct contracts covering the exact snapshot/database filters,
  operation ordering, mini-league and signed-out exclusions, the established
  resolved-error behavior and use of the latest roster after a re-render.
- PitchBoard-focused verification passes 98/98 tests across twelve files.
  TypeScript, extracted-hook lint and the production build pass.
- `PitchBoard.tsx` is now 3,250 lines, down 169 lines (4.9%) during AP6. The
  next safe slice is characterization of full reset versus preserve-lineup
  reset before deciding whether that state-heavy transaction should move.

**AP6e completed locally 11 August 2026:**

- Extracted the full-reset and preserve-lineup-reset transaction into
  `pitch/hooks/usePitchBoardResetGame.ts`, including a pure saved-formation
  resolver. Placement logic remains supplied by PitchBoard and was not
  rewritten.
- Preserved timer-first ordering. Full reset restores all saved team defaults,
  removes game-only fill-ins, zeroes minutes, reapplies the default formation,
  clears AutoSubs and local persistence, and re-enables fresh persistence.
  Preserve-lineup reset keeps positions, fill-ins, settings, AutoSubs and
  storage while zeroing minutes and remounting the clock.
- Added seven contracts covering formation fallback, both reset modes, common
  transient-state cleanup, timer ordering, silent reset and fresh roster state
  after re-render.
- PitchBoard-focused verification passes 105/105 tests across thirteen files.
  TypeScript, extracted-hook lint and the production build pass.
- `PitchBoard.tsx` is now 3,201 lines, down 218 lines (6.4%) during AP6. AP6 is
  complete: the remaining layout-context split would be predominantly
  mechanical and is not recommended before UI review. Proceed to AP7 closeout
  rather than extracting further solely to reduce line count.

### AP7 — Closeout

- Run the complete planner grid and PitchBoard simulation suite.
- Run timer, manual-sub, fill-in, formation, persistence, notification and
  mini-league coverage.
- Run affected Android/iOS-like Playwright journeys.
- Run the complete one-click baseline and verify local-stack cleanup.
- Perform Codespaces UI review before proposing any promotion to `main`.

**Completed locally 11 August 2026:**

- Reviewed the complete worktree scope: production changes remain confined to
  `AutoSubPlanDialog.tsx`, `PitchBoard.tsx` and their extracted planner,
  presentation and orchestration modules. No migration, Edge Function or
  unrelated application production file is part of this tranche.
- The complete refactoring-focused verification passes 246/246 tests across
  30 files. The final affected PitchBoard suite passes 105/105 tests across 13
  files. TypeScript, targeted extracted-module lint and production build pass.
- The one-click baseline passes 4,553 frontend tests, 138 isolated Playwright
  journeys and 258 isolated local-Supabase integration tests. Three dependency
  monitoring cases remain intentionally skipped; there are no failed tests.
- All 24 synthetic local migrations applied successfully. Local RLS, Auth,
  Realtime, Storage, Edge Runtime, timer concurrency and critical journey
  contracts passed.
- Verified cleanup removed every allowlisted local Supabase test container and
  data volume. No hosted Supabase project or hosted frontend/backend was read
  or changed.
- AP-D1 is unchanged: nine soft Standard-mode fairness breaches with halftime
  goalkeeper rotation remain documented product debt, not a refactoring
  regression.
- Automated verification is complete. A manual Codespaces UI review remains a
  promotion decision gate, but is not additional refactoring work.

## Safety and stop conditions

- No hosted Supabase or production/development environment access.
- No schema, RLS, Edge Function or notification-recipient changes hidden in
  refactoring.
- No simultaneous fairness redesign and structural extraction.
- Preserve deterministic planner output during extraction; use golden numeric
  behaviour assertions rather than snapshots of UI markup.
- Stop if a slice changes substitution counts, window times, player totals,
  goalkeeper treatment, notification recipients or persisted game state.
- Keep each slice independently revertible and commit it separately.
